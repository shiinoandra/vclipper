import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const initialUrl = searchParams.get('url') || '';

  const [url, setUrl] = useState(initialUrl);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [inputStart, setInputStart] = useState('');
  const [inputEnd, setInputEnd] = useState('');
  const [processing, setProcessing] = useState(false);
  const playerApiRef = useRef<{ seekTo: (t: number) => void; getCurrentTime: () => number; getDuration: () => number } | null>(null);

  const loadVideo = useCallback(() => {
    const id = extractVideoId(url);
    if (id) {
      setVideoId(id);
      setDuration(0);
      setCurrentTime(0);
      setSegments([]);
      setPendingStart(null);
      setInputStart('');
      setInputEnd('');
    }
  }, [url]);

  // Auto-load video if URL was passed via query param
  useEffect(() => {
    if (initialUrl && !videoId) {
      loadVideo();
    }
  }, [initialUrl, loadVideo, videoId]);

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

  const parseTimeInput = (val: string): number => {
    const parts = val.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  };

  const addBegin = () => {
    setPendingStart(currentTime);
    setInputStart(formatTime(currentTime));
  };

  const addEnd = () => {
    setInputEnd(formatTime(currentTime));
    // If we already have a start (from button or input), add immediately
    const startSec = pendingStart !== null ? pendingStart : parseTimeInput(inputStart);
    const endSec = currentTime;
    if (startSec >= endSec || endSec - startSec < 1) return;
    const seg: ClipSegment = {
      id: `${Date.now()}_${Math.random()}`,
      start: startSec,
      end: endSec,
      color: getColor(segments.length),
      quality: 'default',
      audioBitrate: 'default',
      downloadCC: false,
    };
    setSegments((prev) => [...prev, seg]);
    setPendingStart(null);
    setInputStart('');
    setInputEnd('');
  };

  const addFromInputs = () => {
    const start = parseTimeInput(inputStart);
    const end = parseTimeInput(inputEnd);
    if (start >= end || end - start < 1) {
      alert('End time must be at least 1 second after start time.');
      return;
    }
    const seg: ClipSegment = {
      id: `${Date.now()}_${Math.random()}`,
      start,
      end,
      color: getColor(segments.length),
      quality: 'default',
      audioBitrate: 'default',
      downloadCC: false,
    };
    setSegments((prev) => [...prev, seg]);
    setPendingStart(null);
    setInputStart('');
    setInputEnd('');
  };

  const updateSegment = useCallback((id: string, updates: Partial<ClipSegment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

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
        audio_bitrate: seg.audioBitrate === 'default' ? undefined : seg.audioBitrate,
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
          <Timeline
            duration={duration}
            currentTime={currentTime}
            segments={segments}
            pendingStart={pendingStart}
            onSeek={seekTo}
            onUpdateSegment={updateSegment}
          />

          {/* Controls: timestamp inputs + marker buttons */}
          <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', padding: '12px 14px' }}>
            {/* Row 1: timestamp inputs + Add button */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3 }}>Start</label>
                <input
                  type="text"
                  value={inputStart}
                  onChange={(e) => setInputStart(e.target.value)}
                  placeholder="00:00:00"
                  style={{
                    width: 100,
                    padding: '7px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3 }}>End</label>
                <input
                  type="text"
                  value={inputEnd}
                  onChange={(e) => setInputEnd(e.target.value)}
                  placeholder="00:00:00"
                  style={{
                    width: 100,
                    padding: '7px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <button
                onClick={addFromInputs}
                disabled={!inputStart || !inputEnd}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: 'none',
                  background: inputStart && inputEnd ? '#111' : '#9ca3af',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: inputStart && inputEnd ? 'pointer' : 'not-allowed',
                }}
              >
                Add Clip
              </button>
            </div>

            {/* Row 2: marker buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Or snap to marker:</span>
              <button
                onClick={addBegin}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}
              >
                Set Begin ({formatTime(currentTime)})
              </button>
              <button
                onClick={addEnd}
                disabled={pendingStart === null && !inputStart}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: pendingStart !== null || inputStart ? '#f59e0b' : '#d1d5db',
                  color: '#111',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: pendingStart !== null || inputStart ? 'pointer' : 'not-allowed',
                }}
              >
                Set End & Add
              </button>
            </div>
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
