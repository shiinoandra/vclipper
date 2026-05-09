import { useEffect, useState } from 'react';
import { listClips, connectProgressSSE, cancelClip, deleteClip } from '../api';
import { formatTime } from '../utils/time';
import type { Clip } from '../types';

export default function JobsPage() {
  const [jobs, setJobs] = useState<Clip[]>([]);
  const [progress, setProgress] = useState<Record<number, string>>({});

  const load = async () => {
    const data = await listClips();
    const active = data.filter((c) => c.status === 'pending' || c.status === 'processing');
    setJobs(active);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    jobs.forEach((job) => {
      if (job.status === 'processing') {
        const cleanup = connectProgressSSE(job.id, (val) => {
          setProgress((prev) => ({ ...prev, [job.id]: val }));
          if (val === '100' || val === 'error') {
            load();
          }
        });
        cleanups.push(cleanup);
      }
    });
    return () => cleanups.forEach((c) => c());
  }, [jobs.map((j) => j.id).join(',')]);

  const handleCancel = async (id: number) => {
    try {
      await cancelClip(id);
      load();
    } catch (e: any) {
      alert('Cancel failed: ' + e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this job?')) return;
    try {
      await deleteClip(id);
      load();
    } catch (e: any) {
      alert('Delete failed: ' + e.message);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Jobs</h2>
      {jobs.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No active jobs.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map((job) => {
            const prog = progress[job.id] ?? '0';
            const pct = prog === 'error' ? 0 : Math.min(100, Math.max(0, parseInt(prog, 10)));
            return (
              <div key={job.id} style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{job.title || job.youtube_url}</span>
                  <span style={{ fontSize: 12, color: '#6b7280', textTransform: 'capitalize' }}>{job.status}</span>
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
                  {formatTime(job.start_time)} - {formatTime(job.end_time)}
                </div>
                <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: prog === 'error' ? '#ef4444' : '#3b82f6',
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {prog === 'error' ? 'Error' : `${pct}%`}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleCancel(job.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        background: '#fff',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
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
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
