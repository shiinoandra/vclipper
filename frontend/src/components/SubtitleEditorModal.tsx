import { useState, useRef, useEffect, useCallback } from 'react';
import { getWatchUrl } from '../api';
import { parseSrt, serializeSrt, findActiveCue, type SrtCue } from '../utils/srt';
import { formatTime, formatDuration } from '../utils/time';
import { X, Plus, Pencil, Trash2, Sparkles } from 'lucide-react';

interface SubtitleEditorModalProps {
  clipId: number;
  title?: string;
  initialSrt: string;
  onSave: (srt: string) => void;
  onClose: () => void;
}

/* ─── Helper: Mini Timeline for Add Dialog ─── */

function MiniTimeline({
  duration,
  start,
  end,
  currentTime,
  onChange,
}: {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  onChange: (start: number, end: number) => void;
}) {
  const [dragging, setDragging] = useState<'start' | 'end' | 'range' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const getTimeFromX = (clientX: number) => {
    if (!barRef.current || duration <= 0) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const t = getTimeFromX(e.clientX);
    const startDist = Math.abs(t - start);
    const endDist = Math.abs(t - end);

    if (startDist < endDist) {
      setDragging('start');
      onChange(Math.min(t, end), end);
    } else {
      setDragging('end');
      onChange(start, Math.max(t, start));
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const t = getTimeFromX(e.clientX);
      if (dragging === 'start') {
        onChange(Math.min(t, end), end);
      } else {
        onChange(start, Math.max(t, start));
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, start, end, duration]);

  const startPct = `${(start / duration) * 100}%`;
  const endPct = `${(end / duration) * 100}%`;
  const currentPct = `${(currentTime / duration) * 100}%`;

  return (
    <div style={{ marginTop: 8 }}>
      <div
        ref={barRef}
        onMouseDown={handleMouseDown}
        style={{
          position: 'relative',
          height: 36,
          background: '#e5e7eb',
          borderRadius: 6,
          cursor: 'ew-resize',
          overflow: 'hidden',
        }}
      >
        {/* Selection range */}
        <div
          style={{
            position: 'absolute',
            left: startPct,
            width: `${((end - start) / duration) * 100}%`,
            top: 0,
            bottom: 0,
            background: '#fbbf24',
            opacity: 0.6,
          }}
        />
        {/* Current time line */}
        <div
          style={{
            position: 'absolute',
            left: currentPct,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#111',
            transform: 'translateX(-1px)',
            zIndex: 2,
          }}
        />
        {/* Start handle */}
        <div
          style={{
            position: 'absolute',
            left: startPct,
            top: 0,
            bottom: 0,
            width: 4,
            background: '#f59e0b',
            transform: 'translateX(-2px)',
            zIndex: 3,
            cursor: 'ew-resize',
          }}
        />
        {/* End handle */}
        <div
          style={{
            position: 'absolute',
            left: endPct,
            top: 0,
            bottom: 0,
            width: 4,
            background: '#f59e0b',
            transform: 'translateX(-2px)',
            zIndex: 3,
            cursor: 'ew-resize',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', marginTop: 4 }}>
        <span>{formatTime(start)}</span>
        <span>{formatTime(end)}</span>
      </div>
    </div>
  );
}

/* ─── Main Modal ─── */

export default function SubtitleEditorModal({
  clipId,
  title,
  initialSrt,
  onSave,
  onClose,
}: SubtitleEditorModalProps) {
  const [cues, setCues] = useState<SrtCue[]>(() => parseSrt(initialSrt));
  const [activeCueId, setActiveCueId] = useState<number | null>(null);
  const [editingCueId, setEditingCueId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addStart, setAddStart] = useState(0);
  const [addEnd, setAddEnd] = useState(3);
  const [addText, setAddText] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);

  // Sync video time → active cue
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);

    const active = findActiveCue(cues, t);
    if (active) {
      setActiveCueId(active.id);
    } else {
      setActiveCueId(null);
    }
  }, [cues]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => handleTimeUpdate();
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [handleTimeUpdate]);

  // Scroll active card into view
  useEffect(() => {
    if (activeCardRef.current && listRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCueId]);

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const startEdit = (cue: SrtCue) => {
    setEditingCueId(cue.id);
    setEditingText(cue.text);
  };

  const finishEdit = () => {
    if (editingCueId === null) return;
    setCues((prev) =>
      prev.map((c) => (c.id === editingCueId ? { ...c, text: editingText } : c))
    );
    setEditingCueId(null);
    setEditingText('');
  };

  const deleteCue = (id: number) => {
    setCues((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      // Re-number
      filtered.forEach((c, i) => (c.id = i + 1));
      return [...filtered];
    });
  };

  const openAddDialog = () => {
    const start = currentTime;
    const end = Math.min(videoDuration, start + 3);
    setAddStart(start);
    setAddEnd(end);
    setAddText('');
    setIsAddOpen(true);
  };

  const submitAdd = () => {
    if (!addText.trim()) return;
    const newCue: SrtCue = {
      id: cues.length + 1,
      start: addStart,
      end: addEnd,
      text: addText.trim(),
    };
    const next = [...cues, newCue];
    next.sort((a, b) => a.start - b.start);
    next.forEach((c, i) => (c.id = i + 1));
    setCues(next);
    setIsAddOpen(false);
    setAddText('');
  };

  const handleSave = () => {
    const srt = serializeSrt(cues);
    onSave(srt);
    onClose();
  };

  const activeCue = cues.find((c) => c.id === activeCueId) || null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          background: '#111',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Subtitle Editor</span>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{title || 'Untitled'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Whisper stub */}
          <button
            onClick={() => alert('Auto-transcription coming soon!')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #4b5563',
              background: 'transparent',
              color: '#d1d5db',
              fontSize: 12,
              cursor: 'pointer',
            }}
            title="Auto-transcribe with Whisper (coming soon)"
          >
            <Sparkles size={14} />
            Auto-transcribe
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: 'none',
              background: '#10b981',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Main body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left pane: subtitle list */}
        <div
          ref={listRef}
          style={{
            width: 400,
            minWidth: 400,
            background: '#f3f4f6',
            overflowY: 'auto',
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Add button */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <button
              onClick={openAddDialog}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: '100%',
                padding: '8px',
                borderRadius: 6,
                border: '1px dashed #9ca3af',
                background: '#fff',
                color: '#374151',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} />
              Add Subtitle
            </button>
          </div>

          {/* Cue cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {cues.map((cue) => {
              const isActive = cue.id === activeCueId;
              const isEditing = cue.id === editingCueId;

              return (
                <div
                  key={cue.id}
                  ref={isActive ? activeCardRef : undefined}
                  onClick={() => handleSeek(cue.start)}
                  style={{
                    padding: '10px 14px',
                    background: isActive ? '#fef3c7' : '#fff',
                    borderLeft: isActive ? '3px solid #f59e0b' : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {/* Time row */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                      #{cue.id} · {formatTime(cue.start)} → {formatTime(cue.end)}
                      {' · '}
                      <span style={{ color: '#9ca3af' }}>({formatDuration(cue.end - cue.start)})</span>
                    </span>
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(cue);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 2,
                            cursor: 'pointer',
                            color: '#6b7280',
                          }}
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCue(cue.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 2,
                            cursor: 'pointer',
                            color: '#ef4444',
                          }}
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={finishEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          finishEdit();
                        }
                      }}
                      style={{
                        width: '100%',
                        minHeight: 48,
                        padding: '6px 8px',
                        fontSize: 13,
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: '#111',
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {cue.text || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Empty subtitle</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {cues.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                No subtitles yet.<br />
                Click "Add Subtitle" to create one.
              </div>
            )}
          </div>
        </div>

        {/* Right pane: video + overlay */}
        <div
          style={{
            flex: 1,
            background: '#000',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {/* Video */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={handlePlayPause}
          >
            <video
              ref={videoRef}
              src={getWatchUrl(clipId)}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'block',
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  setVideoDuration(videoRef.current.duration);
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Subtitle overlay */}
            {activeCue && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '12%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  maxWidth: '80%',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    padding: '6px 14px',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 18,
                    lineHeight: 1.4,
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {activeCue.text}
                </div>
              </div>
            )}

            {/* Play indicator when paused */}
            {!isPlaying && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.2)',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.9)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="#111">
                    <polygon points="8,5 8,19 19,12" />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div
            style={{
              background: '#1f2937',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <button
              onClick={handlePlayPause}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="8,5 8,19 19,12" />
                </svg>
              )}
            </button>
            <span style={{ fontSize: 12, color: '#d1d5db', fontFamily: 'monospace', minWidth: 80 }}>
              {formatTime(currentTime)} / {formatTime(videoDuration)}
            </span>
            {/* Seek bar */}
            <div
              style={{ flex: 1, position: 'relative', height: 6, background: '#4b5563', borderRadius: 3, cursor: 'pointer' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                handleSeek(ratio * videoDuration);
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${videoDuration ? (currentTime / videoDuration) * 100 : 0}%`,
                  background: '#3b82f6',
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Add Subtitle Dialog overlay */}
      {isAddOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setIsAddOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              maxWidth: 560,
              width: '100%',
              padding: 24,
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Add Subtitle</h3>

            {/* Mini timeline */}
            <MiniTimeline
              duration={videoDuration || 1}
              start={addStart}
              end={addEnd}
              currentTime={currentTime}
              onChange={(s, e) => {
                setAddStart(s);
                setAddEnd(e);
              }}
            />

            {/* Time inputs */}
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Start</label>
                <input
                  type="text"
                  value={formatTime(addStart)}
                  onChange={(e) => {
                    // Simple HH:MM:SS parsing
                    const parts = e.target.value.split(':').map(Number);
                    let sec = 0;
                    if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
                    else if (parts.length === 1) sec = parts[0];
                    setAddStart(Math.max(0, Math.min(sec, addEnd - 0.5)));
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>End</label>
                <input
                  type="text"
                  value={formatTime(addEnd)}
                  onChange={(e) => {
                    const parts = e.target.value.split(':').map(Number);
                    let sec = 0;
                    if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
                    else if (parts.length === 1) sec = parts[0];
                    setAddEnd(Math.max(addStart + 0.5, Math.min(sec, videoDuration || sec)));
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            </div>

            {/* Text input */}
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Subtitle Text</label>
              <textarea
                autoFocus
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                placeholder="Enter subtitle text..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  fontSize: 13,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setIsAddOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitAdd}
                disabled={!addText.trim()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: 'none',
                  background: '#111',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: addText.trim() ? 'pointer' : 'not-allowed',
                  opacity: addText.trim() ? 1 : 0.5,
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
