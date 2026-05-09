/**
 * SRT Parser and Serializer
 *
 * SRT format:
 *   1
 *   00:00:01,700 --> 00:00:04,490
 *   Subtitle text line 1
 *   Subtitle text line 2
 *
 *   2
 *   00:00:04,490 --> 00:00:06,080
 *   Next subtitle
 */

export interface SrtCue {
  id: number;
  start: number; // seconds with milliseconds
  end: number;   // seconds with milliseconds
  text: string;
}

function parseSrtTime(t: string): number {
  // Handle both comma and period as decimal separator
  t = t.trim().replace('.', ',');
  const m = t.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return 0;
  const [, h, min, s, ms] = m;
  return parseInt(h) * 3600 + parseInt(min) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // First line should be the cue number
    const id = parseInt(lines[0].trim(), 10);
    if (isNaN(id)) continue;

    // Second line is the timecode
    const timeLine = lines[1].trim();
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!timeMatch) continue;

    const start = parseSrtTime(timeMatch[1]);
    const end = parseSrtTime(timeMatch[2]);

    // Remaining lines are the text
    const text = lines.slice(2).join('\n').trim();

    cues.push({ id, start, end, text });
  }

  // Sort by start time
  cues.sort((a, b) => a.start - b.start);

  // Re-number sequentially
  cues.forEach((cue, i) => { cue.id = i + 1; });

  return cues;
}

export function serializeSrt(cues: SrtCue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`
    )
    .join('\n\n') + '\n';
}

export function findActiveCue(cues: SrtCue[], time: number): SrtCue | null {
  for (const cue of cues) {
    if (cue.start <= time && time < cue.end) {
      return cue;
    }
  }
  return null;
}
