import { useState, useEffect, useCallback } from 'react';
import { getStreamSummary, updateStreamSummary, listStreamMoments, addStreamMoment, deleteStreamMoment } from '../api';
import { formatTime, formatDuration } from '../utils/time';
import { X, Trash2, Plus, Play } from 'lucide-react';
import type { LiveStream, StreamMoment } from '../types';

interface StreamSummaryModalProps {
  stream: LiveStream;
  onClose: () => void;
}

const PENDING_SEGMENTS_KEY = 'vclipper_pending_segments';

function getPendingSegments(): { videoUrl: string; segments: { start: number; end: number; description: string }[] } | null {
  try {
    const raw = localStorage.getItem(PENDING_SEGMENTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setPendingSegments(videoUrl: string, segments: { start: number; end: number; description: string }[]) {
  localStorage.setItem(PENDING_SEGMENTS_KEY, JSON.stringify({ videoUrl, segments }));
}

export default function StreamSummaryModal({ stream, onClose }: StreamSummaryModalProps) {
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summarySaving, setSummarySaving] = useState(false);

  const [moments, setMoments] = useState<StreamMoment[]>([]);
  const [momentsLoading, setMomentsLoading] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setSummaryLoading(true);
    setMomentsLoading(true);
    try {
      const [summaryData, momentsData] = await Promise.all([
        getStreamSummary(stream.video_id),
        listStreamMoments(stream.video_id),
      ]);
      setSummaryText(summaryData.summary_text || '');
      setMoments(momentsData);
    } catch (e) {
      console.error('Failed to load stream summary/moments:', e);
    } finally {
      setSummaryLoading(false);
      setMomentsLoading(false);
    }
  }, [stream.video_id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveSummary = async () => {
    setSummarySaving(true);
    try {
      await updateStreamSummary(stream.video_id, summaryText);
    } catch (e: any) {
      alert('Failed to save summary: ' + e.message);
    } finally {
      setSummarySaving(false);
    }
  };

  const handleAddMoment = async () => {
    const startParts = newStart.split(':').map(Number);
    const endParts = newEnd.split(':').map(Number);

    let startSec = 0;
    let endSec = 0;

    if (startParts.length === 3) startSec = startParts[0] * 3600 + startParts[1] * 60 + startParts[2];
    else if (startParts.length === 2) startSec = startParts[0] * 60 + startParts[1];
    else if (startParts.length === 1) startSec = startParts[0];

    if (endParts.length === 3) endSec = endParts[0] * 3600 + endParts[1] * 60 + endParts[2];
    else if (endParts.length === 2) endSec = endParts[0] * 60 + endParts[1];
    else if (endParts.length === 1) endSec = endParts[0];

    if (endSec <= startSec) {
      alert('End time must be after start time');
      return;
    }

    try {
      const created = await addStreamMoment(stream.video_id, {
        start_time: startSec,
        end_time: endSec,
        description: newDesc.trim(),
      });
      setMoments((prev) => [...prev, created].sort((a, b) => a.start_time - b.start_time));
      setNewStart('');
      setNewEnd('');
      setNewDesc('');
      setAdding(false);
    } catch (e: any) {
      alert('Failed to add moment: ' + e.message);
    }
  };

  const handleDeleteMoment = async (id: number) => {
    if (!confirm('Delete this moment?')) return;
    try {
      await deleteStreamMoment(id);
      setMoments((prev) => prev.filter((m) => m.id !== id));
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e: any) {
      alert('Failed to delete moment: ' + e.message);
    }
  };

  const handleAddToQueue = (moment: StreamMoment) => {
    const pending = getPendingSegments();
    const videoUrl = stream.video_url || '';

    let segments: { start: number; end: number; description: string }[] = [];

    if (pending && pending.videoUrl === videoUrl) {
      // Same stream — append
      segments = pending.segments;
    }
    // Different stream — start fresh (or no pending)

    // Avoid duplicates
    const exists = segments.some((s) => s.start === moment.start_time && s.end === moment.end_time);
    if (!exists) {
      segments.push({
        start: moment.start_time,
        end: moment.end_time,
        description: moment.description || '',
      });
      setPendingSegments(videoUrl, segments);
    }

    setAddedIds((prev) => new Set(prev).add(moment.id));
  };

  const handleGoToClip = () => {
    const pending = getPendingSegments();
    if (pending && pending.segments.length > 0) {
      // Navigate to clip page with the video URL
      window.open(`/clip?url=${encodeURIComponent(stream.video_url || '')}`, '_blank');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 700,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {stream.channel_avatar && (
              <img src={stream.channel_avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{stream.channel_name || 'Unknown'}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={22} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px' }}>
          {/* Thumbnail */}
          <a
            href={stream.video_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              width: '100%',
              aspectRatio: '16/9',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#000',
              marginTop: 16,
              position: 'relative',
            }}
          >
            {stream.thumbnail_url ? (
              <img
                src={stream.thumbnail_url}
                alt={stream.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14 }}>
                No thumbnail
              </div>
            )}
            {/* Play overlay */}
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
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Play size={24} fill="#111" />
              </div>
            </div>
          </a>

          {/* Title */}
          <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
            {stream.title || 'Untitled'}
          </div>

          {/* Summary */}
          <div style={{ marginTop: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Summary</label>
            <textarea
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              placeholder="Stream summary..."
              rows={4}
              disabled={summaryLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 80,
              }}
            />
          </div>

          {/* Moments */}
          <div style={{ marginTop: 24, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Moments</label>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{moments.length} total</span>
            </div>

            {momentsLoading ? (
              <p style={{ fontSize: 13, color: '#6b7280' }}>Loading moments...</p>
            ) : moments.length === 0 && !adding ? (
              <p style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>No moments yet. Click "+ Add moment" below to add one.</p>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                {moments.map((moment, idx) => (
                  <div
                    key={moment.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderBottom: idx < moments.length - 1 ? '1px solid #e5e7eb' : 'none',
                      background: addedIds.has(moment.id) ? '#f0fdf4' : '#fff',
                    }}
                  >
                    {/* Time range */}
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#6b7280', minWidth: 110, flexShrink: 0 }}>
                      {formatTime(moment.start_time)} – {formatTime(moment.end_time)}
                    </div>

                    {/* Description */}
                    <div style={{ flex: 1, fontSize: 13, color: '#111', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {moment.description || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No description</span>}
                    </div>

                    {/* Duration */}
                    <div style={{ fontSize: 11, color: '#9ca3af', minWidth: 50, textAlign: 'right' }}>
                      {formatDuration(moment.end_time - moment.start_time)}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleAddToQueue(moment)}
                        disabled={addedIds.has(moment.id)}
                        title={addedIds.has(moment.id) ? 'Added to queue' : 'Add to clip queue'}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          background: addedIds.has(moment.id) ? '#10b981' : '#fff',
                          color: addedIds.has(moment.id) ? '#fff' : '#374151',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: addedIds.has(moment.id) ? 'default' : 'pointer',
                        }}
                      >
                        {addedIds.has(moment.id) ? 'Added' : 'Add to clip'}
                      </button>
                      <button
                        onClick={() => handleDeleteMoment(moment.id)}
                        title="Delete moment"
                        style={{
                          padding: 4,
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          background: '#fff',
                          color: '#ef4444',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new moment form */}
            {adding && (
              <div style={{ marginTop: 10, padding: 14, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3 }}>Start (HH:MM:SS)</label>
                    <input
                      type="text"
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                      placeholder="00:00:00"
                      style={{
                        width: 100,
                        padding: '6px 8px',
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3 }}>End (HH:MM:SS)</label>
                    <input
                      type="text"
                      value={newEnd}
                      onChange={(e) => setNewEnd(e.target.value)}
                      placeholder="00:00:00"
                      style={{
                        width: 100,
                        padding: '6px 8px',
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3 }}>Description</label>
                    <input
                      type="text"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="What happens at this moment..."
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        fontSize: 12,
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setAdding(false)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddMoment}
                    disabled={!newStart.trim() || !newEnd.trim()}
                    style={{
                      padding: '5px 14px',
                      borderRadius: 4,
                      border: 'none',
                      background: !newStart.trim() || !newEnd.trim() ? '#9ca3af' : '#3b82f6',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: !newStart.trim() || !newEnd.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Add Moment
                  </button>
                </div>
              </div>
            )}

            {!adding && (
              <button
                onClick={() => setAdding(true)}
                style={{
                  marginTop: 10,
                  width: '100%',
                  padding: '8px',
                  borderRadius: 6,
                  border: '1px dashed #d1d5db',
                  background: '#fff',
                  color: '#6b7280',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Plus size={14} />
                Add moment
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => alert('Auto-generate coming soon!')}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Auto generate
            </button>
            <button
              onClick={handleGoToClip}
              disabled={addedIds.size === 0}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: addedIds.size === 0 ? '#9ca3af' : '#3b82f6',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: addedIds.size === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Go to Clip Page ({addedIds.size})
            </button>
          </div>
          <button
            onClick={handleSaveSummary}
            disabled={summarySaving}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#111',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: summarySaving ? 'not-allowed' : 'pointer',
            }}
          >
            {summarySaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
