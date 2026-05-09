# VClipper

A YouTube video clipping application with a React frontend, Flask REST API, and yt-dlp for downloading.

## Features

- Paste a YouTube URL and load the video player
- Mark start/end timestamps on a visual timeline
- Queue multiple clips with distinct colors
- Per-clip video/audio quality overrides and CC download toggle
- Process clips asynchronously via background threads
- Live progress updates via Server-Sent Events
- Cancel, retry, and delete jobs
- History of completed/failed/cancelled clips
- Configurable default yt-dlp quality presets

## Prerequisites

- Python 3.10+
- Node.js 20+
- Docker & Docker Compose (for PostgreSQL)
- ffmpeg

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Start Backend

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL=postgresql://vclipper:vclipper@localhost:5432/vclipper python app.py
```

### 3. Start Frontend

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Project Structure

```
vclipper/
├── backend/
│   ├── app.py              # Flask API + download threads
│   ├── models.py           # SQLAlchemy models
│   ├── config.py           # Configuration
│   └── requirements.txt    # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── api.ts          # API client
│   │   ├── components/     # YouTubePlayer, Timeline, ClipQueue, Layout
│   │   └── pages/          # Home, Clip, Jobs, History, Settings
│   ├── vite.config.ts      # Vite config with /api proxy
│   └── package.json
├── docker-compose.yml      # PostgreSQL
└── AGENTS.md               # Developer/agent notes
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/clips` | Create clips (batch) |
| GET | `/api/clips` | List clips (optional `?status=`) |
| GET | `/api/clips/<id>` | Get single clip |
| DELETE | `/api/clips/<id>` | Delete clip |
| POST | `/api/clips/<id>/cancel` | Cancel a running clip |
| POST | `/api/clips/<id>/retry` | Retry a failed/cancelled clip |
| GET | `/api/clips/<id>/progress` | SSE progress stream |
| GET | `/api/settings` | Get settings |
| POST | `/api/settings` | Update settings |
| GET | `/api/health` | Health check |

## Database

**Why PostgreSQL instead of SQLite?**

SQLite is a file-based database designed for single-process, local access. If you want multiple users or multiple server instances to access the database concurrently, SQLite over a network share will corrupt. PostgreSQL is a proper client-server database that handles concurrent connections safely and is the standard choice for web applications.

The app falls back to SQLite if `DATABASE_URL` is not set, but PostgreSQL is recommended for any multi-user or production deployment.

## License

MIT
