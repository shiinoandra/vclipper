import { useState, useEffect, useRef } from 'react';
import type { ClipSegment } from '../types';
import { formatTime } from '../utils/time';

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'
];

export function getColor(index: number) {
  return COLORS[index % COLORS.length];
}

interface TimelineProps {
  duration: number;
  currentTime: number;
  segments: ClipSegment[];
  pendingStart: number | null;
  onSeek: (time: number) => void;
  onUpdateSegment?: (id: string, updates: Partial<ClipSegment>) => void;
}

export default function Timeline({
  duration,
  currentTime,
  segments,
  pendingStart,
  onSeek,
  onUpdateSegment,
}: TimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ segId: string; handle: 'start' | 'end' } | null>(null);

  // Use refs for values that change frequently to avoid effect re-runs
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const onUpdateRef = useRef(onUpdateSegment);
  onUpdateRef.current = onUpdateSegment;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const getTimeFromX = (clientX: number) => {
    if (!barRef.current || durationRef.current <= 0) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * durationRef.current;
  };

  const handleBgClick = (e: React.MouseEvent) => {
    // Only seek if clicking directly on background (not on segment/handle)
    const target = e.target as HTMLElement;
    if (target.closest('[data-segment]')) return;
    const t = getTimeFromX(e.clientX);
    onSeek(t);
  };

  const startDrag = (segId: string, handle: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging({ segId, handle });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const updater = onUpdateRef.current;
      if (!updater) return;
      const t = getTimeFromX(e.clientX);
      const seg = segmentsRef.current.find((s) => s.id === dragging.segId);
      if (!seg) return;
      if (dragging.handle === 'start') {
        const newStart = Math.min(t, seg.end - 0.5);
        updater(seg.id, { start: Math.max(0, newStart) });
      } else {
        const newEnd = Math.max(t, seg.start + 0.5);
        updater(seg.id, { end: Math.min(durationRef.current, newEnd) });
      }
    };

    const handleUp = () => setDragging(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]); // only re-run when dragging starts/stops

  const seekerLeft = `${(currentTime / duration) * 100}%`;

  // Render empty placeholder when duration is not yet known
  if (!duration || duration <= 0) {
    return <div style={{ marginTop: 8, height: 32, background: '#e5e7eb', borderRadius: 4 }} />;
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 14, position: 'relative' }}>
      {/* Blue triangle seeker handle above timeline */}
      <div
        style={{
          position: 'absolute',
          left: seekerLeft,
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

      <div
        ref={barRef}
        onClick={handleBgClick}
        style={{
          position: 'relative',
          height: 32,
          background: '#e5e7eb',
          borderRadius: 4,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {segments.map((seg) => {
          const leftPct = `${(seg.start / duration) * 100}%`;
          const widthPct = `${((seg.end - seg.start) / duration) * 100}%`;

          return (
            <div
              key={seg.id}
              data-segment="true"
              style={{ position: 'absolute', left: leftPct, width: widthPct, top: 0, bottom: 0 }}
            >
              {/* Segment body — click to seek to start */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(seg.start);
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: seg.color,
                  opacity: 0.75,
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
                title={`${formatTime(seg.start)} - ${formatTime(seg.end)}`}
              />
              {/* Start handle */}
              {onUpdateSegment && (
                <div
                  onMouseDown={startDrag(seg.id, 'start')}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    background: 'rgba(0,0,0,0.4)',
                    cursor: 'col-resize',
                    zIndex: 2,
                  }}
                />
              )}
              {/* End handle */}
              {onUpdateSegment && (
                <div
                  onMouseDown={startDrag(seg.id, 'end')}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    background: 'rgba(0,0,0,0.4)',
                    cursor: 'col-resize',
                    zIndex: 2,
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Pending start marker line */}
        {pendingStart !== null && (
          <div
            style={{
              position: 'absolute',
              left: `${(pendingStart / duration) * 100}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#f59e0b',
              borderLeft: '2px dashed #f59e0b',
              zIndex: 1,
            }}
          />
        )}

        {/* Current time line (blue) */}
        <div
          style={{
            position: 'absolute',
            left: seekerLeft,
            top: 0,
            bottom: 0,
            width: 3,
            background: '#3b82f6',
            transform: 'translateX(-1.5px)',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginTop: 4 }}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
