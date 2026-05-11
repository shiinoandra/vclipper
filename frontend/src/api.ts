import type { Clip, Settings, TrackedChannel, LiveStreamGroup, StreamSummary, StreamMoment } from './types';

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

export function getDownloadUrl(id: number): string {
  return `${API_BASE}/clips/${id}/download`;
}

export function getWatchUrl(id: number): string {
  return `${API_BASE}/clips/${id}/watch`;
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

// ─── Channels ───

export async function listChannels(): Promise<TrackedChannel[]> {
  return fetchJson<TrackedChannel[]>(`${API_BASE}/channels`);
}

export async function addChannel(url: string): Promise<TrackedChannel> {
  return fetchJson<TrackedChannel>(`${API_BASE}/channels`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function deleteChannel(id: number): Promise<void> {
  await fetch(`${API_BASE}/channels/${id}`, { method: 'DELETE' });
}

export async function updateChannelTags(id: number, tags: string[]): Promise<TrackedChannel> {
  return fetchJson<TrackedChannel>(`${API_BASE}/channels/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
}

// ─── Live Streams ───

export async function listLiveStreams(tag?: string): Promise<LiveStreamGroup[]> {
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return fetchJson<LiveStreamGroup[]>(`${API_BASE}/live${qs}`);
}

// ─── Subtitles ───

export async function getSubtitles(clipId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/clips/${clipId}/subtitles`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.text();
}

export async function updateSubtitles(clipId: number, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/clips/${clipId}/subtitles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
}

export async function transcribeClip(
  clipId: number,
  language?: string
): Promise<{ success: boolean; transcript: string; srt: string; path: string }> {
  const res = await fetch(`${API_BASE}/clips/${clipId}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: language || undefined }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json();
}

// ─── Stream Summaries ───

export async function getStreamSummary(videoId: string): Promise<StreamSummary> {
  return fetchJson<StreamSummary>(`${API_BASE}/streams/${encodeURIComponent(videoId)}/summary`);
}

export async function updateStreamSummary(videoId: string, summaryText: string): Promise<StreamSummary> {
  return fetchJson<StreamSummary>(`${API_BASE}/streams/${encodeURIComponent(videoId)}/summary`, {
    method: 'PUT',
    body: JSON.stringify({ summary_text: summaryText }),
  });
}

// ─── Stream Moments ───

export async function listStreamMoments(videoId: string): Promise<StreamMoment[]> {
  return fetchJson<StreamMoment[]>(`${API_BASE}/streams/${encodeURIComponent(videoId)}/moments`);
}

export async function addStreamMoment(
  videoId: string,
  moment: Omit<StreamMoment, 'id' | 'video_id' | 'created_at' | 'updated_at'>
): Promise<StreamMoment> {
  return fetchJson<StreamMoment>(`${API_BASE}/streams/${encodeURIComponent(videoId)}/moments`, {
    method: 'POST',
    body: JSON.stringify(moment),
  });
}

export async function deleteStreamMoment(momentId: number): Promise<void> {
  await fetch(`${API_BASE}/streams/moments/${momentId}`, { method: 'DELETE' });
}
