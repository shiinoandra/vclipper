import { useState, useEffect } from 'react';
import { listChannels, addChannel, deleteChannel } from '../api';
import type { TrackedChannel } from '../types';

export default function ChannelSettings() {
  const [channels, setChannels] = useState<TrackedChannel[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const data = await listChannels();
    setChannels(data);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await addChannel(url.trim());
      setUrl('');
      load();
    } catch (e: any) {
      alert('Failed to add channel: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this channel from tracking?')) return;
    await deleteChannel(id);
    load();
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Tracked Channels</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste YouTube channel URL (e.g. @channelname or /channel/UC...)"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <button
          onClick={handleAdd}
          disabled={loading}
          style={{
            padding: '8px 14px',
            borderRadius: 4,
            border: 'none',
            background: '#111',
            color: '#fff',
            fontSize: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>

      {channels.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>No channels tracked yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map((ch) => (
            <div
              key={ch.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                background: '#f9fafb',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
              }}
            >
              {ch.avatar_url && (
                <img
                  src={ch.avatar_url}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{ch.channel_name || ch.channel_id}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{ch.channel_id}</div>
              </div>
              <button
                onClick={() => handleDelete(ch.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
