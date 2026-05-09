import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';
import type { Settings } from '../types';

const VIDEO_QUALITIES = [
  { label: 'Default (720p)', value: 'default' },
  { label: 'Best available', value: 'best' },
  { label: '1080p or lower', value: 'best[height<=1080]' },
  { label: '720p or lower', value: 'best[height<=720]' },
  { label: '480p or lower', value: 'best[height<=480]' },
  { label: 'Worst available', value: 'worst' },
];

const AUDIO_QUALITIES = [
  { label: 'Default (128k AAC)', value: 'default' },
  { label: 'Best audio', value: 'bestaudio' },
  { label: 'High (256k)', value: 'bestaudio[abr<=256]' },
  { label: 'Medium (128k)', value: 'bestaudio[abr<=128]' },
  { label: 'Worst audio', value: 'worstaudio' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggle = (key: string) => {
    setSettings((prev) => ({ ...prev, [key]: prev[key] === 'true' ? 'false' : 'true' }));
  };

  const handleSave = async () => {
    setSaving(true);
    await updateSettings(settings);
    setSaving(false);
    alert('Settings saved.');
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Settings</h2>
      <div style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb', maxWidth: 500 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default Video Quality</label>
          <select
            value={settings.default_quality || 'default'}
            onChange={(e) => handleChange('default_quality', e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 14 }}
          >
            {VIDEO_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            "Default" falls back to 720p if the yt-dlp preset is unavailable.
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default Audio Quality</label>
          <select
            value={settings.default_audio_quality || 'default'}
            onChange={(e) => handleChange('default_audio_quality', e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 14 }}
          >
            {AUDIO_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            "Default" falls back to 128k AAC if the yt-dlp preset is unavailable.
          </p>
        </div>

        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="thumb"
            type="checkbox"
            checked={settings.download_thumbnail === 'true'}
            onChange={() => handleToggle('download_thumbnail')}
          />
          <label htmlFor="thumb" style={{ fontSize: 14 }}>Download Thumbnails</label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default Output Directory</label>
          <input
            type="text"
            value={settings.default_output_dir || ''}
            onChange={(e) => handleChange('default_output_dir', e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 14 }}
            placeholder="./downloads"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 18px',
            borderRadius: 6,
            border: 'none',
            background: '#111',
            color: '#fff',
            fontSize: 14,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
