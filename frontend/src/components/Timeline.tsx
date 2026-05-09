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
}

export default function Timeline({ duration, currentTime, segments, pendingStart, onSeek }: TimelineProps) {
  if (!duration || duration <= 0) return null;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  const seekerLeft = `${(currentTime / duration) * 100}%`;

  return (
    <div style={{ marginTop: 8, paddingTop: 12, position: 'relative' }}>
      {/* Seeker handle above timeline */}
      <div
        style={{
          position: 'absolute',
          left: seekerLeft,
          top: 0,
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '10px solid #111',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: seekerLeft,
          top: 10,
          transform: 'translateX(-50%)',
          width: 10,
          height: 10,
          background: '#111',
          borderRadius: '50%',
          zIndex: 2,
        }}
      />

      <div
        onClick={handleClick}
        style={{
          position: 'relative',
          height: 32,
          background: '#e5e7eb',
          borderRadius: 4,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.id}
            style={{
              position: 'absolute',
              left: `${(seg.start / duration) * 100}%`,
              width: `${((seg.end - seg.start) / duration) * 100}%`,
              top: 0,
              bottom: 0,
              background: seg.color,
              opacity: 0.75,
              borderRadius: 2,
            }}
            title={`${formatTime(seg.start)} - ${formatTime(seg.end)}`}
          />
        ))}

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

        {/* Seeker line */}
        <div
          style={{
            position: 'absolute',
            left: seekerLeft,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#111',
            transform: 'translateX(-1px)',
            zIndex: 2,
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
