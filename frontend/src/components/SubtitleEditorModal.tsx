import { useState, useRef, useEffect, useCallback } from 'react';
import { getWatchUrl } from '../api';
import { parseSrt, serializeSrt, findActiveCue, type SrtCue } from '../utils/srt';
import { formatTime, formatDuration } from '../utils/time';
import { X, Pencil, Trash2, Sparkles, Scissors } from 'lucide-react';

interface SubtitleEditorModalProps {
  clipId: number;
  title?: string;
  initialSrt: string;
  onSave: (srt: string) => void;
  onClose: () => void;
}

/* ─── AddTimeline ───
 * Blue bar  = current playback position marker (dedicated, not draggable)
 * Yellow    = selected segment range
 * Drag      = only on segment border handles (col-resize cursor)
 * Click bg  = seeks video to that time
 * Buttons   = Set Start / Set End snap segment to blue marker
 */

function AddTimeline({
  duration,
  start,
  end,
  currentTime,
  onChange,
  onSeek,
}: {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  onChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
}) {
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const getTimeFromX = (clientX: number) => {
    if (!barRef.current || duration <= 0) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const startDrag = (handle: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    setDragging(handle);
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

  const handleBgClick = (e: React.MouseEvent) => {
    const t = getTimeFromX(e.clientX);
    onSeek(t);
  };

  // Clamp display so end always >= start
  const displayStart = Math.min(start, end);
  const displayEnd = Math.max(start, end);

  const startPct = `${(displayStart / duration) * 100}%`;
  const endPct = `${(displayEnd / duration) * 100}%`;
  const currentPct = `${(currentTime / duration) * 100}%`;

  return (
    <div style={{ position: 'relative', paddingTop: 14 }}>
      {/* Blue triangle seeker handle above bar */}
      <div
        style={{
          position: 'absolute',
          left: currentPct,
          top: 0,
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: '12px solid #3b82f6',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      />

      {/* Bar background — clicking seeks video */}
      <div
        ref={barRef}
        onClick={handleBgClick}
        style={{
          position: 'relative',
          height: 28,
          background: '#374151',
          borderRadius: 4,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {/* Selection range */}
        <div
          style={{
            position: 'absolute',
            left: startPct,
            width: `${((displayEnd - displayStart) / duration) * 100}%`,
            top: 0,
            bottom: 0,
            background: '#f59e0b',
            opacity: 0.4,
            pointerEvents: 'none',
          }}
        />
        {/* Current time marker (blue) — thicker for visibility */}
        <div
          style={{
            position: 'absolute',
            left: currentPct,
            top: 0,
            bottom: 0,
            width: 3,
            background: '#3b82f6',
            transform: 'translateX(-1.5px)',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
        {/* Start handle */}
        <div
          onMouseDown={startDrag('start')}
          style={{
            position: 'absolute',
            left: startPct,
            top: 0,
            bottom: 0,
            width: 8,
            background: '#fbbf24',
            transform: 'translateX(-4px)',
            zIndex: 3,
            cursor: 'col-resize',
          }}
        />
        {/* End handle */}
        <div
          onMouseDown={startDrag('end')}
          style={{
            position: 'absolute',
            left: endPct,
            top: 0,
            bottom: 0,
            width: 8,
            background: '#fbbf24',
            transform: 'translateX(-4px)',
            zIndex: 3,
            cursor: 'col-resize',
          }}
        />
      </div>

      {/* Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        <span style={{ color: '#fbbf24' }}>{formatTime(start)}</span>
        <span style={{ color: '#3b82f6', fontWeight: 600 }}>{formatTime(currentTime)}</span>
        <span style={{ color: '#fbbf24' }}>{formatTime(end)}</span>
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

  const [addStart, setAddStart] = useState(0);
  const [addEnd, setAddEnd] = useState(3);
  const [addText, setAddText] = useState('');

  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);

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
      filtered.forEach((c, i) => (c.id = i + 1));
      return [...filtered];
    });
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
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                      #{cue.id} · {formatTime(cue.start)} → {formatTime(cue.end)}
                      {' · '}
                      <span style={{ color: '#9ca3af' }}>({formatDuration(cue.end - cue.start)})</span>
                    </span>
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(cue); }}
                          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#6b7280' }}
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCue(cue.id); }}
                          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#ef4444' }}
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

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
                    <div style={{ fontSize: 13, color: '#111', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                      {cue.text || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Empty subtitle</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {cues.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                No subtitles yet.<br />
                Use the form below the video to add one.
              </div>
            )}
          </div>
        </div>

        {/* Right pane: video + bottom bars (shared alignment) */}
        <div
          style={{
            flex: 1,
            background: '#000',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
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
              minHeight: 0,
            }}
            onClick={handlePlayPause}
          >
            <video
              ref={videoRef}
              src={getWatchUrl(clipId)}
              style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  const dur = videoRef.current.duration;
                  setVideoDuration(dur);
                  setAddStart(0);
                  setAddEnd(Math.min(3, dur));
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

          {/* ── Shared bottom area (controls + add form) ── */}
          <div style={{ background: '#1f2937', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Shared flex row: left column (controls) + right column (bars) */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              {/* Left column: play + timestamp (shared width) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0 10px 16px',
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={handlePlayPause}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}
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
              </div>

              {/* Right column: both bars stacked, perfectly aligned */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '10px 16px 10px 12px',
                  gap: 10,
                }}
              >
                {/* Video seek bar */}
                <div
                  style={{ position: 'relative', height: 6, background: '#4b5563', borderRadius: 3, cursor: 'pointer' }}
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

                {/* Add timeline — shares exact left edge with video seek bar */}
                <AddTimeline
                  duration={videoDuration || 1}
                  start={addStart}
                  end={addEnd}
                  currentTime={currentTime}
                  onChange={(s, e) => {
                    setAddStart(s);
                    setAddEnd(e);
                  }}
                  onSeek={handleSeek}
                />
              </div>
            </div>

            {/* Inline Add Form */}
            <div
              style={{
                borderTop: '1px solid #374151',
                padding: '10px 16px 12px',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              {/* Set Start / Set End buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, paddingTop: 2 }}>
                <button
                  onClick={() => setAddStart(currentTime)}
                  title="Set segment start to current playback position"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #4b5563',
                    background: '#1f2937',
                    color: '#fbbf24',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Scissors size={12} />
                  Set Start
                </button>
                <button
                  onClick={() => setAddEnd(Math.max(currentTime, addStart + 0.5))}
                  title="Set segment end to current playback position"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '5px 10px',
                    borderRadius: 4,
                    border: '1px solid #4b5563',
                    background: '#1f2937',
                    color: '#fbbf24',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Scissors size={12} />
                  Set End
                </button>
              </div>

              {/* Time inputs */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 2 }}>Start</label>
                  <input
                    type="text"
                    value={formatTime(addStart)}
                    onChange={(e) => {
                      const parts = e.target.value.split(':').map(Number);
                      let sec = 0;
                      if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                      else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
                      else if (parts.length === 1) sec = parts[0];
                      setAddStart(Math.max(0, Math.min(sec, addEnd - 0.5)));
                    }}
                    style={{
                      width: 90,
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid #4b5563',
                      background: '#111827',
                      color: '#fff',
                      fontSize: 12,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 2 }}>End</label>
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
                    onBlur={() => {
                      // Force minimum 0.5s duration
                      if (addEnd < addStart + 0.5) {
                        setAddEnd(addStart + 0.5);
                      }
                    }}
                    style={{
                      width: 90,
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid #4b5563',
                      background: '#111827',
                      color: '#fff',
                      fontSize: 12,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>
              </div>

              {/* Text + Add */}
              <textarea
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                placeholder="Enter subtitle text..."
                rows={2}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: '1px solid #4b5563',
                  background: '#111827',
                  color: '#fff',
                  fontSize: 13,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  minHeight: 44,
                }}
              />

              <button
                onClick={submitAdd}
                disabled={!addText.trim()}
                style={{
                  padding: '8px 18px',
                  borderRadius: 4,
                  border: 'none',
                  background: addText.trim() ? '#f59e0b' : '#4b5563',
                  color: '#111',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: addText.trim() ? 'pointer' : 'not-allowed',
                  opacity: addText.trim() ? 1 : 0.5,
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                  marginTop: 16,
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
