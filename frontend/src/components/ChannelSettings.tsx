import { useState, useEffect } from 'react';
import { listChannels, addChannel, deleteChannel, updateChannelTags } from '../api';
import type { TrackedChannel } from '../types';

function parseTags(channel: TrackedChannel): string[] {
  if (!channel.tags) return [];
  try {
    const parsed = JSON.parse(channel.tags);
    if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string');
  } catch {
    // fallthrough
  }
  return [];
}

function TagEditor({ channel, onUpdate }: { channel: TrackedChannel; onUpdate: () => void }) {
  const [tags, setTags] = useState<string[]>(parseTags(channel));
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (newTags: string[]) => {
    setSaving(true);
    try {
      await updateChannelTags(channel.id, newTags);
      setTags(newTags);
      onUpdate();
    } catch (e: any) {
      alert('Failed to update tags: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const raw = input.trim();
    if (!raw) return;
    const newTags = [...tags];
    for (const t of raw.split(/[,\s]+/)) {
      const cleaned = t.trim().toLowerCase();
      if (cleaned && !newTags.includes(cleaned)) {
        newTags.push(cleaned);
      }
    }
    setInput('');
    save(newTags);
  };

  const removeTag = (tag: string) => {
    save(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#e5e7eb',
              color: '#374151',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 12,
            }}
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              disabled={saving}
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: 13,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
              title="Remove tag"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? 'Add tag…' : '+ tag'}
          disabled={saving}
          style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 12,
            border: '1px solid #d1d5db',
            width: tags.length === 0 ? 80 : 50,
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}

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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{ch.channel_name || ch.channel_id}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{ch.channel_id}</div>
                <TagEditor channel={ch} onUpdate={load} />
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
