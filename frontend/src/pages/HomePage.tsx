import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listLiveStreams } from '../api';
import type { LiveStreamGroup, LiveStream } from '../types';

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === yesterday.getTime()) return 'Yesterday';

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const wd = weekdays[date.getDay()];
  return `${mm}/${dd} (${wd})`;
}

function formatStreamTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const STREAMS_PER_PAGE = 12; // ~3 rows of 4 cards each

function StreamCard({ stream }: { stream: LiveStream }) {
  const navigate = useNavigate();

  const handleClip = () => {
    if (stream.video_url) {
      navigate(`/clip?url=${encodeURIComponent(stream.video_url)}`);
    }
  };

  const isLive = stream.status === 'live';
  const isUpcoming = stream.status === 'upcoming';
  const canClip = !isUpcoming && stream.video_url;

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header row: LIVE badge + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px' }}>
        {isLive && (
          <span
            style={{
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            LIVE
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
          {formatStreamTime(stream.actual_start || stream.scheduled_start)}
        </span>
      </div>

      {/* Thumbnail — links to original YouTube video */}
      <a
        href={stream.video_url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}
      >
        {stream.thumbnail_url ? (
          <img
            src={stream.thumbnail_url}
            alt={stream.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 12 }}>
            No thumbnail
          </div>
        )}
      </a>

      {/* Footer row 1: avatar + channel name (truncated) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 4px' }}>
        {stream.channel_avatar ? (
          <img
            src={stream.channel_avatar}
            alt=""
            style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e5e7eb', flexShrink: 0 }} />
        )}
        <span
          style={{
            fontSize: 13,
            color: '#374151',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title={stream.channel_name || 'Unknown'}
        >
          {stream.channel_name || 'Unknown'}
        </span>
      </div>

      {/* Footer row 2: Clip button */}
      {canClip && (
        <div style={{ padding: '4px 10px 8px' }}>
          <button
            onClick={handleClip}
            style={{
              width: '100%',
              padding: '6px',
              borderRadius: 4,
              border: 'none',
              background: '#111',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clip
          </button>
        </div>
      )}
    </div>
  );
}

function PaginatedStreamGrid({ streams }: { streams: LiveStream[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(streams.length / STREAMS_PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [streams.length]);

  const paginated = streams.slice(page * STREAMS_PER_PAGE, (page + 1) * STREAMS_PER_PAGE);

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {paginated.map((stream) => (
          <StreamCard key={stream.video_id} stream={stream} />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: 13,
              cursor: page === 0 ? 'not-allowed' : 'pointer',
              opacity: page === 0 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: 13,
              cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages - 1 ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

export default function HomePage() {
  const [groups, setGroups] = useState<LiveStreamGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await listLiveStreams();
      setGroups(data);
    } catch (e) {
      console.error('Failed to load live streams:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 300000); // Refresh every 5 minutes
    return () => clearInterval(iv);
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Home</h2>

      {groups.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No live streams or recent uploads from tracked channels.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groups.map((group) => (
            <div key={group.date}>
              {/* Date header */}
              <div
                style={{
                  background: '#374151',
                  color: '#fff',
                  padding: '10px 16px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                {formatDateHeader(group.date)}
              </div>

              <PaginatedStreamGrid streams={group.streams} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
