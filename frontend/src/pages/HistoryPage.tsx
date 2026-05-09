import { useEffect, useState } from 'react';
import { listClips, deleteClip, retryClip } from '../api';
import { formatTime } from '../utils/time';
import type { Clip } from '../types';

export default function HistoryPage() {
  const [clips, setClips] = useState<Clip[]>([]);

  const load = async () => {
    const data = await listClips();
    setClips(data.filter((c) => c.status === 'completed' || c.status === 'failed' || c.status === 'cancelled'));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this record?')) return;
    await deleteClip(id);
    load();
  };

  const handleRetry = async (id: number) => {
    try {
      await retryClip(id);
      alert('Clip re-queued. Check the Jobs tab.');
      load();
    } catch (e: any) {
      alert('Retry failed: ' + e.message);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>History</h2>
      {clips.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No history yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {clips.map((clip) => (
            <div
              key={clip.id}
              style={{
                background: '#fff',
                padding: 16,
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {clip.title || clip.youtube_url}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {formatTime(clip.start_time)} - {formatTime(clip.end_time)} ·{' '}
                  <span
                    style={{
                      color:
                        clip.status === 'completed'
                          ? '#10b981'
                          : clip.status === 'cancelled'
                          ? '#f59e0b'
                          : '#ef4444',
                      fontWeight: 500,
                    }}
                  >
                    {clip.status}
                  </span>
                </div>
                {clip.output_path && (
                  <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 4 }}>{clip.output_path}</div>
                )}
                {clip.error_message && (
                  <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{clip.error_message}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(clip.status === 'failed' || clip.status === 'cancelled') && (
                  <button
                    onClick={() => handleRetry(clip.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: 'none',
                      background: '#3b82f6',
                      color: '#fff',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={() => handleDelete(clip.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
