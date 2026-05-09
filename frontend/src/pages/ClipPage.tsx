import { useState, useRef, useCallback } from 'react';
import YouTubePlayer from '../components/YouTubePlayer';
import Timeline from '../components/Timeline';
import ClipQueue from '../components/ClipQueue';
import { createClips } from '../api';
import type { ClipSegment } from '../types';
import { getColor } from '../components/Timeline';
import { formatTime } from '../utils/time';

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  return m ? m[1] : null;
}

export default function ClipPage() {
  const [url, setUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const playerApiRef = useRef<{ seekTo: (t: number) => void; getCurrentTime: () => number; getDuration: () => number } | null>(null);

  const loadVideo = () => {
    const id = extractVideoId(url);
    if (id) {
      setVideoId(id);
      setDuration(0);
      setCurrentTime(0);
      setSegments([]);
      setPendingStart(null);
    }
  };

  const handleReady = useCallback((api: any) => {
    playerApiRef.current = api;
    // Try to get duration after a short delay
    setTimeout(() => {
      try {
        const d = api.getDuration?.() || 0;
        if (d) setDuration(d);
      } catch {}
    }, 1500);
  }, []);

  const handleTimeUpdate = useCallback((t: number) => {
    setCurrentTime(t);
    if (!duration) {
      try {
        const d = playerApiRef.current?.getDuration?.() || 0;
        if (d) setDuration(d);
      } catch {}
    }
  }, [duration]);

  const seekTo = (t: number) => {
    playerApiRef.current?.seekTo(t);
  };

  const addBegin = () => {
    setPendingStart(currentTime);
  };

  const addEnd = () => {
    if (pendingStart === null) return;
    const start = Math.min(pendingStart, currentTime);
    const end = Math.max(pendingStart, currentTime);
    if (end - start < 1) return;
    const seg: ClipSegment = {
      id: `${Date.now()}_${Math.random()}`,
      start,
      end,
      color: getColor(segments.length),
      quality: 'default',
      audioQuality: 'default',
      downloadCC: false,
    };
    setSegments((prev) => [...prev, seg]);
    setPendingStart(null);
  };

  const updateSegment = (id: string, updates: Partial<ClipSegment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const removeSegment = (id: string) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  const processAll = async () => {
    if (segments.length === 0) return;
    setProcessing(true);
    try {
      const payload = segments.map((seg) => ({
        youtube_url: url,
        start_time: seg.start,
        end_time: seg.end,
        quality: seg.quality === 'default' ? undefined : seg.quality,
        audio_quality: seg.audioQuality === 'default' ? undefined : seg.audioQuality,
        download_cc: seg.downloadCC,
      }));
      await createClips(payload);
      setSegments([]);
      alert('Clips queued successfully! Check the Jobs tab.');
    } catch (e: any) {
      alert('Failed to queue clips: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Clip</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste YouTube URL"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <button
          onClick={loadVideo}
          style={{ padding: '10px 18px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 14, cursor: 'pointer' }}
        >
          Load
        </button>
      </div>

      {videoId && (
        <>
          <YouTubePlayer videoId={videoId} onReady={handleReady} onTimeUpdate={handleTimeUpdate} />
          <Timeline duration={duration} currentTime={currentTime} segments={segments} pendingStart={pendingStart} onSeek={seekTo} />

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              onClick={addBegin}
              style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}
            >
              Set Begin ({pendingStart !== null ? formatTime(pendingStart) : 'now'})
            </button>
            <button
              onClick={addEnd}
              disabled={pendingStart === null}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                background: pendingStart !== null ? '#111' : '#9ca3af',
                color: '#fff',
                cursor: pendingStart !== null ? 'pointer' : 'not-allowed',
                fontSize: 14,
              }}
            >
              Set End & Add Clip
            </button>
          </div>

          <ClipQueue segments={segments} onUpdate={updateSegment} onRemove={removeSegment} />

          {segments.length > 0 && (
            <button
              onClick={processAll}
              disabled={processing}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '12px',
                borderRadius: 6,
                border: 'none',
                background: '#10b981',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: processing ? 'not-allowed' : 'pointer',
                opacity: processing ? 0.7 : 1,
              }}
            >
              {processing ? 'Queueing...' : 'Process All Clips'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
