import type { Clip, Settings } from './types';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function createClips(clips: Partial<Clip>[]): Promise<Clip[]> {
  return fetchJson<Clip[]>(`${API_BASE}/clips`, {
    method: 'POST',
    body: JSON.stringify(clips),
  });
}

export async function listClips(status?: string): Promise<Clip[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchJson<Clip[]>(`${API_BASE}/clips${qs}`);
}

export async function deleteClip(id: number): Promise<void> {
  await fetch(`${API_BASE}/clips/${id}`, { method: 'DELETE' });
}

export async function cancelClip(id: number): Promise<Clip> {
  return fetchJson<Clip>(`${API_BASE}/clips/${id}/cancel`, { method: 'POST' });
}

export async function retryClip(id: number): Promise<Clip> {
  return fetchJson<Clip>(`${API_BASE}/clips/${id}/retry`, { method: 'POST' });
}

export async function getSettings(): Promise<Settings> {
  return fetchJson<Settings>(`${API_BASE}/settings`);
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return fetchJson<Settings>(`${API_BASE}/settings`, {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export function connectProgressSSE(clipId: number, onProgress: (val: string) => void) {
  const evtSource = new EventSource(`${API_BASE}/clips/${clipId}/progress`);
  evtSource.onmessage = (e) => {
    onProgress(e.data);
    if (e.data === '100' || e.data === 'error') {
      evtSource.close();
    }
  };
  evtSource.onerror = () => {
    evtSource.close();
  };
  return () => evtSource.close();
}
