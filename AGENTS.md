# VClipper — Agent Notes

## Run Order (all must be running)

1. **PostgreSQL** — start via Docker Compose.
   - `docker compose up -d` (from repo root)
   - PostgreSQL must be on `localhost:5432`.
   - Default DB credentials: `vclipper` / `vclipper` / `vclipper`.

2. **Flask API** — from the `backend/` directory.
   - `cd backend && python app.py` (port 5000)
   - **Always run Flask commands from `backend/`** because imports are absolute (`from config import Config`).
   - Set `DATABASE_URL` env var for PostgreSQL, e.g.:
     - `postgresql://vclipper:vclipper@localhost:5432/vclipper`
   - Falls back to `sqlite:///vclipper.db` if `DATABASE_URL` is unset.

3. **Vite Dev Server** — from the `frontend/` directory.
   - `cd frontend && npm run dev` (port 5173)
   - Proxies `/api/*` to `localhost:5000` via `vite.config.ts`.

## Architecture

- **Backend**: Flask REST API + PostgreSQL + background threads.
- **Frontend**: React + TypeScript + Vite + React Router.
- **Clip engine**: Two-tier download strategy in `backend/app.py`.
  - **Strategy A (Smart ffmpeg seek)** — extracts DASH video+audio URLs via yt-dlp without downloading, then invokes ffmpeg directly with `-ss` input-seeking and 10 MB HTTP chunk limits (`-request_size 10000000`). Forces MP4/M4A container for efficient seeking. Downloads roughly the segment size (~15-50 MB for a 1-minute 720p clip) instead of the full video.
  - **Strategy B (Full download + cut)** — if Strategy A fails, falls back to downloading the full video with yt-dlp's native downloader (avoids throttling) and cutting locally with ffmpeg. Used automatically for reliability.
- **Progress**: SSE endpoint `/api/clips/<id>/progress`. Strategy A shows estimated progress (time-based); Strategy B shows real yt-dlp download progress.
- **Dedup**: Creating a clip with the same `youtube_url`, `start_time`, and `end_time` skips if an existing record has status `pending`, `processing`, or `completed`. Cancelled clips are ignored for dedup.
- **Job state**: Clip metadata lives in PostgreSQL; active downloads run as daemon threads inside the single Flask process. On restart, any clips previously marked `processing` are auto-marked `failed`.
- **Cancel/Retry**: A `threading.Event` flag signals the download loop to abort. Strategy A cancels the ffmpeg subprocess directly. Retry resets the clip status and spawns a fresh thread.
- **Per-clip quality**: Each segment in the queue can override video/audio quality. "default" falls back to the global setting (720p video / 128k AAC).
- **Closed captions**: If enabled per-clip, yt-dlp downloads the full subtitle file, then the backend parses SRT/VTT, strips WebVTT cue tags (e.g. `<02:44:19.359><c> be.</c>`), filters entries overlapping the segment, shifts timestamps to start at 00:00:00, and saves a `.srt` next to the video.
- **Live stream tracking**: A background thread polls tracked channels every 5 minutes via yt-dlp. Detects live, upcoming, and ended streams. Home page groups them by date and supports tag-based filtering. Add/remove channels and edit tags in Settings → Tracked Channels.

## Important File Locations

| Purpose | Path |
|---------|------|
| Flask app | `backend/app.py` |
| Models / DB | `backend/models.py` |
| API client | `frontend/src/api.ts` |
| Vite proxy config | `frontend/vite.config.ts` |

## yt-dlp & ffmpeg

- yt-dlp downloads video sections using `download_ranges`. ffmpeg is invoked internally by yt-dlp for cutting.
- ffmpeg must be installed and on `PATH`.
- Output files land in `./downloads/` by default (configurable in Settings).

## Common Commands

```bash
# Install deps
cd backend && pip install -r requirements.txt
cd frontend && npm install

# Start infrastructure
docker compose up -d

# Start everything (2 more terminals)
cd backend && python app.py
cd frontend && npm run dev
```

## Frontend Tab Routes

- `/` — Home: live streams and recent uploads from tracked channels, grouped by date
- `/clip` — YouTube player + timeline + queue + process. Accepts `?url=` query param to auto-load a video
- `/jobs` — Active jobs with live SSE progress bars
- `/collections` — Gallery of completed clips with watch, download, and retry
- `/settings` — Default yt-dlp params + Tracked Channels management

## Notes

- Do **not** run Flask from the repo root; Python imports will fail.
- Do **not** run multiple Flask workers (e.g. gunicorn with multiple processes) — the in-memory progress store and cancel events live in a single process.
- The SSE endpoint has a 1-hour max streaming loop to prevent leaks.
- `video_codec` on a clip triggers an FFmpeg postprocessor if set (not exposed in UI currently).
