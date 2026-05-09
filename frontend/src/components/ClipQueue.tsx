import type { ClipSegment } from '../types';
import { formatTime } from '../utils/time';

interface ClipQueueProps {
  segments: ClipSegment[];
  onUpdate: (id: string, updates: Partial<ClipSegment>) => void;
  onRemove: (id: string) => void;
}

const VIDEO_QUALITIES = [
  { label: 'Default', value: 'default' },
  { label: 'Best', value: 'best' },
  { label: '1080p', value: 'best[height<=1080]' },
  { label: '720p', value: 'best[height<=720]' },
  { label: '480p', value: 'best[height<=480]' },
  { label: 'Worst', value: 'worst' },
];

const AUDIO_QUALITIES = [
  { label: 'Default', value: 'default' },
  { label: 'Best Audio', value: 'bestaudio' },
  { label: 'High (256k)', value: 'bestaudio[abr<=256]' },
  { label: 'Medium (128k)', value: 'bestaudio[abr<=128]' },
  { label: 'Worst Audio', value: 'worstaudio' },
];

export default function ClipQueue({ segments, onUpdate, onRemove }: ClipQueueProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Clip Queue ({segments.length})</h3>
      {segments.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>No clips added yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {segments.map((seg) => (
            <li
              key={seg.id}
              style={{
                padding: '10px 12px',
                background: '#f9fafb',
                borderRadius: 6,
                marginBottom: 8,
                borderLeft: `4px solid ${seg.color}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                  {formatTime(seg.start)} - {formatTime(seg.end)}
                </span>
                <button
                  onClick={() => onRemove(seg.id)}
                  style={{
                    background: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Video</label>
                  <select
                    value={seg.quality}
                    onChange={(e) => onUpdate(seg.id, { quality: e.target.value })}
                    style={{ fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #d1d5db' }}
                  >
                    {VIDEO_QUALITIES.map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Audio</label>
                  <select
                    value={seg.audioQuality}
                    onChange={(e) => onUpdate(seg.id, { audioQuality: e.target.value })}
                    style={{ fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #d1d5db' }}
                  >
                    {AUDIO_QUALITIES.map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={seg.downloadCC}
                    onChange={(e) => onUpdate(seg.id, { downloadCC: e.target.checked })}
                  />
                  Download CC
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
