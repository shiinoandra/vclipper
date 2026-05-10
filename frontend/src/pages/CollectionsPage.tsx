import { useEffect, useState } from 'react';
import { listClips, deleteClip, retryClip, getDownloadUrl, getWatchUrl, getSubtitles, updateSubtitles } from '../api';
import { formatTime, formatDuration } from '../utils/time';
import type { Clip } from '../types';
import { Monitor, Volume2, Subtitles, PenLine } from 'lucide-react';
import SubtitleEditorModal from '../components/SubtitleEditorModal';

function getYouTubeThumbnail(url: string): string {
  const m = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : '';
}

function VideoModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  if (!clip) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#111',
          borderRadius: 12,
          overflow: 'hidden',
          maxWidth: 900,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{clip.title || 'Untitled'}</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <video
          src={getWatchUrl(clip.id)}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: '70vh', background: '#000' }}
        />
        <div style={{ padding: '10px 16px', color: '#9ca3af', fontSize: 12 }}>
          {formatTime(clip.start_time)} - {formatTime(clip.end_time)}
        </div>
      </div>
    </div>
  );
}

function MediaInfoPanel({ clip }: { clip: Clip }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        justifyContent: 'center',
        padding: '0 8px',
        minWidth: 100,
      }}
    >
      {/* Video resolution */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Video resolution">
        <Monitor size={14} color="#6b7280" />
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
          {clip.video_resolution || '—'}
        </span>
      </div>

      {/* Audio codec */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Audio codec">
        <Volume2 size={14} color="#6b7280" />
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
          {clip.audio_codec || '—'}
        </span>
      </div>

      {/* CC status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Closed captions">
        <Subtitles size={14} color={clip.has_cc ? '#10b981' : '#6b7280'} />
        <span style={{ fontSize: 12, color: clip.has_cc ? '#10b981' : '#374151', fontWeight: 500 }}>
          {clip.has_cc ? 'CC' : 'No CC'}
        </span>
      </div>
    </div>
  );
}

export default function CollectionsPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [watching, setWatching] = useState<Clip | null>(null);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [editingSrt, setEditingSrt] = useState<string>('');
  const [loadingSrt, setLoadingSrt] = useState(false);

  const load = async () => {
    const data = await listClips();
    setClips(data.filter((c) => c.status === 'completed' || c.status === 'failed' || c.status === 'cancelled'));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this clip?')) return;
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

  const handleEditSubtitles = async (clip: Clip) => {
    setLoadingSrt(true);
    try {
      const srt = await getSubtitles(clip.id);
      setEditingSrt(srt);
      setEditingClip(clip);
    } catch (e: any) {
      alert('Failed to load subtitles: ' + e.message);
    } finally {
      setLoadingSrt(false);
    }
  };

  const handleSaveSubtitles = async (srt: string) => {
    if (!editingClip) return;
    try {
      await updateSubtitles(editingClip.id, srt);
      // Refresh clip list to update has_cc status
      load();
    } catch (e: any) {
      alert('Failed to save subtitles: ' + e.message);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Collections</h2>
      {clips.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No clips yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {clips.map((clip) => {
            const thumb = getYouTubeThumbnail(clip.youtube_url);
            const canWatch = !!(clip.status === 'completed' && clip.output_path);
            const canDownload = !!(clip.status === 'completed' && clip.output_path);
            const duration = clip.end_time - clip.start_time;

            return (
              <div
                key={clip.id}
                style={{
                  background: '#fff',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  gap: 12,
                  padding: 12,
                  alignItems: 'stretch',
                }}
              >
                {/* Thumbnail with hover play overlay */}
                <ThumbnailWithHoverPlay
                  thumb={thumb}
                  canWatch={canWatch}
                  onPlay={() => canWatch && setWatching(clip)}
                />

                {/* Info + actions */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {clip.title || 'Untitled'}
                    </div>
                    <a
                      href={clip.youtube_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {clip.youtube_url}
                    </a>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      {formatTime(clip.start_time)} - {formatTime(clip.end_time)}{' '}
                      <span style={{ color: '#9ca3af' }}>({formatDuration(duration)})</span>
                      {' · '}
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
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {canDownload && (
                      <button
                        onClick={() => handleEditSubtitles(clip)}
                        disabled={loadingSrt}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 14px',
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          background: '#fff',
                          color: '#111',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: loadingSrt ? 'not-allowed' : 'pointer',
                          opacity: loadingSrt ? 0.6 : 1,
                        }}
                      >
                        <PenLine size={13} />
                        {clip.has_cc ? 'Edit Subtitle' : 'Generate Subtitle'}
                      </button>
                    )}
                    {canDownload && (
                      <a
                        href={getDownloadUrl(clip.id)}
                        download
                        style={{
                          padding: '6px 14px',
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          background: '#fff',
                          color: '#111',
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-block',
                        }}
                      >
                        Download
                      </a>
                    )}
                    {(clip.status === 'failed' || clip.status === 'cancelled') && (
                      <button
                        onClick={() => handleRetry(clip.id)}
                        style={{
                          padding: '6px 14px',
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
                        padding: '6px 14px',
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

                {/* Right-side media info */}
                <MediaInfoPanel clip={clip} />
              </div>
            );
          })}
        </div>
      )}

      {watching && <VideoModal clip={watching} onClose={() => setWatching(null)} />}

      {editingClip && (
        <SubtitleEditorModal
          clipId={editingClip.id}
          title={editingClip.title}
          initialSrt={editingSrt}
          onSave={handleSaveSubtitles}
          onClose={() => {
            setEditingClip(null);
            setEditingSrt('');
          }}
        />
      )}
    </div>
  );
}

function ThumbnailWithHoverPlay({
  thumb,
  canWatch,
  onPlay,
}: {
  thumb: string;
  canWatch: boolean;
  onPlay: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        width: 160,
        minWidth: 160,
        aspectRatio: '16/9',
        borderRadius: 6,
        overflow: 'hidden',
        background: '#000',
        position: 'relative',
        cursor: canWatch ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPlay}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 12 }}>
          No thumb
        </div>
      )}
      {canWatch && hovered && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#111">
              <polygon points="8,5 8,19 19,12" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
