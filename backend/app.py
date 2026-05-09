import os
import time
import threading
import re
import subprocess
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from config import Config
from models import db, Clip, Setting

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    CORS(app)

    with app.app_context():
        db.create_all()
        Setting.init_defaults()
        Clip.query.filter(Clip.status == "processing").update({
            "status": "failed",
            "error_message": "Server restarted before completion"
        })
        db.session.commit()

    return app

app = create_app()

_progress = {}
_progress_lock = threading.Lock()
_cancel_events = {}


def _set_progress(clip_id, value):
    with _progress_lock:
        _progress[clip_id] = value


def _get_progress(clip_id):
    with _progress_lock:
        return _progress.get(clip_id, "0")


def _clear_progress(clip_id):
    with _progress_lock:
        _progress.pop(clip_id, None)


def _resolve_format(quality, audio_quality, settings):
    """Resolve 'default' to a yt-dlp format string with MP4/M4A preference for efficient ffmpeg seeking.
    
    Uses separate DASH streams (bestvideo+bestaudio) for quality.
    Forces MP4/M4A containers because ffmpeg HTTP seeking is much faster on MP4 than WebM.
    """
    q = quality or settings.get("default_quality", "default")
    aq = audio_quality or settings.get("default_audio_quality", "default")

    # Resolve 'default' to hardcoded safe values
    if q == "default":
        q = "bestvideo[height<=720]"
    if aq == "default":
        aq = "bestaudio[abr<=128]"

    # Pure audio-only selection (e.g. "bestaudio")
    if q.startswith("bestaudio") or q.startswith("worstaudio"):
        return f"{q}[ext=m4a]/{q}"

    # Convert combined-format selectors to video-only so we can pair them with audio.
    # 'best' alone means "best combined format" which is usually 640x360 on YouTube.
    def _to_video_selector(fmt):
        if fmt.startswith("bestvideo") or fmt.startswith("worstvideo"):
            return fmt
        if fmt == "best":
            return "bestvideo"
        if fmt == "worst":
            return "worstvideo"
        # 'best[height<=720]' or similar → prepend 'bestvideo'
        if fmt.startswith("best["):
            return fmt.replace("best[", "bestvideo[", 1)
        if fmt.startswith("worst["):
            return fmt.replace("worst[", "worstvideo[", 1)
        return fmt

    video_sel = _to_video_selector(q)
    audio_sel = aq if (aq.startswith("bestaudio") or aq.startswith("worstaudio")) else "bestaudio"

    # Simple format string: DASH video+audio with MP4/M4A preference, fallback to combined MP4.
    # Do NOT add extra / fallbacks before the + — yt-dlp evaluates / before +.
    return f"{video_sel}[ext=mp4]+{audio_sel}[ext=m4a]/best[ext=mp4]/best"


def _parse_srt_time(t):
    m = re.match(r"(\d+):(\d+):(\d+),(\d+)", t.strip())
    if m:
        h, mi, s, ms = map(int, m.groups())
        return h * 3600 + mi * 60 + s + ms / 1000.0
    return 0.0


def _format_srt_time(sec):
    h = int(sec // 3600)
    mi = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int((sec - int(sec)) * 1000)
    return f"{h:02d}:{mi:02d}:{s:02d},{ms:03d}"


def _clean_subtitle_text(text: str) -> str:
    text = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", text)
    text = re.sub(r"<\d{2}:\d{2}\.\d{3}>", "", text)
    text = re.sub(r"</?[a-zA-Z][^>]*>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _slice_subtitles(content, start_sec, end_sec):
    lines = content.strip().splitlines()
    entries = []
    i = 0
    time_re = re.compile(r"(\d+[:\d\.]+)\s*-->\s*(\d+[:\d\.]+)")

    def parse_time(t):
        t = t.strip().replace(".", ",")
        if "," not in t:
            parts = t.split(":")
            if len(parts) == 3:
                h, m, s = parts
                return int(h) * 3600 + int(m) * 60 + float(s)
            elif len(parts) == 2:
                m, s = parts
                return int(m) * 60 + float(s)
        return _parse_srt_time(t)

    current_entry = None
    while i < len(lines):
        line = lines[i]
        tm = time_re.match(line)
        if tm:
            t1 = parse_time(tm.group(1))
            t2 = parse_time(tm.group(2))
            current_entry = {"start": t1, "end": t2, "text": []}
            i += 1
            while i < len(lines) and lines[i].strip():
                current_entry["text"].append(lines[i])
                i += 1
            entries.append(current_entry)
            current_entry = None
        i += 1

    filtered = []
    for e in entries:
        if e["end"] < start_sec or e["start"] > end_sec:
            continue
        e["start"] = max(0, e["start"] - start_sec)
        e["end"] = max(0, e["end"] - start_sec)
        e["end"] = min(e["end"], end_sec - start_sec)
        filtered.append(e)

    out = []
    for idx, e in enumerate(filtered, 1):
        out.append(str(idx))
        out.append(f"{_format_srt_time(e['start'])} --> {_format_srt_time(e['end'])}")
        cleaned_lines = [_clean_subtitle_text(t) for t in e["text"] if _clean_subtitle_text(t)]
        if cleaned_lines:
            out.extend(cleaned_lines)
            out.append("")

    return "\n".join(out)


def _download_and_slice_cc(clip, output_dir):
    import yt_dlp

    sub_opts = {
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en"],
        "skip_download": True,
        "outtmpl": os.path.join(output_dir, f"clip_{clip.id}_%(title).100B"),
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(sub_opts) as sub_ydl:
        sub_ydl.download([clip.youtube_url])

    sub_files = []
    for f in os.listdir(output_dir):
        if f.startswith(f"clip_{clip.id}_") and (f.endswith(".srt") or f.endswith(".vtt")):
            sub_files.append(os.path.join(output_dir, f))

    if not sub_files:
        return None

    sub_file = sub_files[0]
    with open(sub_file, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    sliced = _slice_subtitles(content, clip.start_time, clip.end_time)

    video_base = os.path.splitext(clip.output_path or "")[0]
    out_sub = video_base + ".srt"
    with open(out_sub, "w", encoding="utf-8") as f:
        f.write(sliced)

    for sf in sub_files:
        try:
            os.remove(sf)
        except OSError:
            pass

    return out_sub


def _ffmpeg_seek_download(clip, fmt, output_dir, cancel_event):
    """Strategy A: Extract DASH URLs and invoke ffmpeg with input-seeking.
    Returns the output file path on success, raises Exception on failure."""
    import yt_dlp

    final_path = os.path.join(output_dir, f"clip_{clip.id}.mp4")
    duration = clip.end_time - clip.start_time

    # Clean up any stale output
    if os.path.exists(final_path):
        os.remove(final_path)

    # 1. Extract format URLs without downloading
    info_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(info_opts) as ydl:
        info = ydl.extract_info(clip.youtube_url, download=False)

        # yt-dlp returns separate DASH formats in 'requested_formats' when using "video+audio".
        # For combined formats it returns a single format in the root info dict.
        requested = info.get("requested_formats", [])

        if len(requested) >= 2:
            # DASH: separate video and audio streams
            video_url = requested[0].get("url")
            audio_url = requested[1].get("url")
        elif len(requested) == 1:
            # Single requested format (combined or video-only)
            video_url = requested[0].get("url")
            audio_url = None
        elif info.get("url"):
            # Fallback: combined format selected directly
            video_url = info["url"]
            audio_url = None
        else:
            raise Exception("Strategy A: no format URL available from yt-dlp")

        if not video_url:
            raise Exception("Strategy A: could not extract video URL")

    # 2. Build ffmpeg command with input-seeking
    # Note: -request_size is NOT a valid ffmpeg CLI option; it only exists
    # inside yt-dlp's FFmpegFD wrapper. We rely on ffmpeg's native HTTP
    # seeking which works well for MP4/M4A containers.
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]

    # Video input (input-seeking: -ss before -i)
    cmd += [
        "-ss", str(clip.start_time),
        "-t", str(duration),
        "-i", video_url,
    ]

    # Audio input (if separate)
    if audio_url:
        cmd += [
            "-ss", str(clip.start_time),
            "-t", str(duration),
            "-i", audio_url,
        ]

    # Output options
    cmd += ["-c", "copy"]
    if audio_url:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        final_path,
    ]

    # 3. Run ffmpeg with polling for cancellation
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    stderr_data = b""
    start_time = time.time()
    while proc.poll() is None:
        if cancel_event.is_set():
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            if os.path.exists(final_path):
                os.remove(final_path)
            raise Exception("Cancelled by user")

        # Fake progress: ramp up to 90% over ~30s then hold
        elapsed = time.time() - start_time
        fake_pct = min(90, int(elapsed * 3))
        _set_progress(clip.id, str(fake_pct))
        time.sleep(0.5)

    # Collect stderr for diagnostics
    stdout, stderr_data = proc.communicate(timeout=5)

    if proc.returncode != 0:
        err_text = stderr_data.decode("utf-8", errors="ignore").strip()[:500]
        if os.path.exists(final_path):
            os.remove(final_path)
        raise Exception(f"Strategy A: ffmpeg failed (rc={proc.returncode}): {err_text}")

    # Verify output exists and is not tiny (indicates failure)
    if not os.path.exists(final_path) or os.path.getsize(final_path) < 1024:
        raise Exception("Strategy A: ffmpeg output missing or empty")

    return final_path


def _full_download_then_cut(clip, fmt, output_dir, cancel_event):
    """Strategy B (fallback): Download full video with yt-dlp, then ffmpeg-cut.
    Returns the output file path."""
    import yt_dlp

    tmp_outtmpl = os.path.join(output_dir, f"_full_{clip.id}_%(title).100B.%(ext)s")
    final_path = os.path.join(output_dir, f"clip_{clip.id}.mp4")
    duration = clip.end_time - clip.start_time

    def progress_hook(d):
        if cancel_event.is_set():
            raise Exception("Cancelled by user")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            if total and total > 0:
                pct = min(100.0, downloaded / total * 100)
            else:
                pct = 0
            _set_progress(clip.id, str(int(pct)))
        elif d["status"] == "finished":
            _set_progress(clip.id, "100")

    full_ydl_opts = {
        "format": fmt,
        "outtmpl": tmp_outtmpl,
        "merge_output_format": "mp4",
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
    }

    if clip.video_codec:
        full_ydl_opts["postprocessors"] = [
            {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}
        ]

    if clip.download_thumbnail:
        full_ydl_opts["writethumbnail"] = True
        full_ydl_opts["embed_thumbnail"] = True

    full_path = None
    with yt_dlp.YoutubeDL(full_ydl_opts) as ydl:
        info = ydl.extract_info(clip.youtube_url, download=True)
        clip.title = info.get("title", "Unknown")
        expected = ydl.prepare_filename(info)
        if os.path.exists(expected):
            full_path = expected
        else:
            base = os.path.splitext(expected)[0]
            for ext in [".mp4", ".webm", ".mkv", ".m4a", ".mp3"]:
                candidate = base + ext
                if os.path.exists(candidate):
                    full_path = candidate
                    break

    if cancel_event.is_set():
        raise Exception("Cancelled by user")

    if not full_path or not os.path.exists(full_path):
        raise Exception("Download failed: full video not found")

    ffmpeg_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(clip.start_time),
        "-t", str(duration),
        "-i", full_path,
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        final_path,
    ]
    subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not os.path.exists(final_path):
        raise Exception("FFmpeg cut failed: output file not created")

    # Clean up full download
    try:
        os.remove(full_path)
        for side_ext in [".jpg", ".png", ".webp", ".info.json", ".description"]:
            side = os.path.splitext(full_path)[0] + side_ext
            if os.path.exists(side):
                os.remove(side)
    except OSError:
        pass

    return final_path


def run_clip(clip_id):
    import yt_dlp

    cancel_event = threading.Event()
    _cancel_events[clip_id] = cancel_event

    try:
        with app.app_context():
            clip = Clip.query.get(clip_id)
            if not clip:
                return

            clip.status = "processing"
            db.session.commit()

            output_dir = os.path.abspath(clip.output_dir or Config.DEFAULT_OUTPUT_DIR)
            os.makedirs(output_dir, exist_ok=True)

            settings = Setting.get_all()
            fmt = _resolve_format(clip.quality, clip.audio_quality, settings)

            # Try Strategy A (smart ffmpeg seek) first
            _set_progress(clip_id, "5")
            try:
                output_path = _ffmpeg_seek_download(clip, fmt, output_dir, cancel_event)
            except Exception as seek_err:
                # Fallback to Strategy B (full download then cut)
                _set_progress(clip_id, "0")
                output_path = _full_download_then_cut(clip, fmt, output_dir, cancel_event)
                # Append Strategy A error as info so user knows what happened
                clip.error_message = f"[{seek_err}] — fell back to full download"

            clip.output_path = output_path

            if clip.download_cc and clip.output_path:
                try:
                    _download_and_slice_cc(clip, output_dir)
                except Exception as cc_err:
                    clip.error_message = (clip.error_message or "") + f" [CC error: {cc_err}]"

            if cancel_event.is_set():
                clip.status = "cancelled"
                clip.error_message = "Cancelled by user"
            else:
                clip.status = "completed"
                clip.error_message = None
            _set_progress(clip_id, "100")
            db.session.commit()

    except Exception as e:
        with app.app_context():
            clip = Clip.query.get(clip_id)
            if clip:
                db.session.rollback()
                clip.status = "failed"
                clip.error_message = str(e)
                db.session.commit()
        _set_progress(clip_id, "error")
    finally:
        _cancel_events.pop(clip_id, None)


@app.route("/api/clips", methods=["POST"])
def create_clips():
    data = request.get_json() or {}
    items = data if isinstance(data, list) else [data]
    created = []

    for item in items:
        url = item.get("youtube_url")
        start = item.get("start_time")
        end = item.get("end_time")
        if not url or start is None or end is None:
            continue

        dup = Clip.query.filter(
            Clip.youtube_url == url,
            Clip.start_time == start,
            Clip.end_time == end,
            Clip.status.in_(["pending", "processing", "completed"])
        ).first()
        if dup:
            created.append(dup.to_dict())
            continue

        settings = Setting.get_all()
        quality = item.get("quality") or settings.get("default_quality", "default")
        audio_quality = item.get("audio_quality") or settings.get("default_audio_quality", "default")

        clip = Clip(
            youtube_url=url,
            start_time=start,
            end_time=end,
            quality=quality,
            video_codec=item.get("video_codec") or settings.get("default_video_codec", None),
            audio_quality=audio_quality,
            download_thumbnail=item.get("download_thumbnail", settings.get("download_thumbnail", "false")).lower() == "true",
            download_cc=item.get("download_cc", False),
            output_dir=item.get("output_dir") or settings.get("default_output_dir", "./downloads"),
        )
        db.session.add(clip)
        db.session.commit()

        thread = threading.Thread(target=run_clip, args=(clip.id,), daemon=True)
        thread.start()

        created.append(clip.to_dict())

    return jsonify(created), 201

@app.route("/api/clips", methods=["GET"])
def list_clips():
    status = request.args.get("status")
    q = Clip.query.order_by(Clip.created_at.desc())
    if status:
        q = q.filter(Clip.status == status)
    return jsonify([c.to_dict() for c in q.all()])

@app.route("/api/clips/<int:clip_id>", methods=["GET"])
def get_clip(clip_id):
    clip = Clip.query.get_or_404(clip_id)
    return jsonify(clip.to_dict())

@app.route("/api/clips/<int:clip_id>", methods=["DELETE"])
def delete_clip(clip_id):
    clip = Clip.query.get_or_404(clip_id)
    event = _cancel_events.get(clip_id)
    if event:
        event.set()
    db.session.delete(clip)
    db.session.commit()
    _clear_progress(clip_id)
    return jsonify({"deleted": True})

@app.route("/api/clips/<int:clip_id>/cancel", methods=["POST"])
def cancel_clip(clip_id):
    clip = Clip.query.get_or_404(clip_id)
    event = _cancel_events.get(clip_id)
    if event:
        event.set()
    clip.status = "cancelled"
    db.session.commit()
    return jsonify(clip.to_dict())

@app.route("/api/clips/<int:clip_id>/retry", methods=["POST"])
def retry_clip(clip_id):
    clip = Clip.query.get_or_404(clip_id)
    if clip.status not in ("failed", "cancelled"):
        return jsonify({"error": "Can only retry failed or cancelled clips"}), 400
    _clear_progress(clip_id)
    clip.status = "pending"
    clip.error_message = None
    db.session.commit()
    thread = threading.Thread(target=run_clip, args=(clip.id,), daemon=True)
    thread.start()
    return jsonify(clip.to_dict())

@app.route("/api/clips/<int:clip_id>/progress")
def clip_progress(clip_id):
    def event_stream():
        with app.app_context():
            last = None
            for _ in range(3600):
                val = _get_progress(clip_id)
                if val != last:
                    last = val
                    yield f"data: {val}\n\n"
                clip = Clip.query.get(clip_id)
                if clip and clip.status in ("completed", "failed", "cancelled"):
                    yield f"data: {val}\n\n"
                    yield "event: close\ndata: done\n\n"
                    break
                time.sleep(1)
    return Response(event_stream(), mimetype="text/event-stream")

@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(Setting.get_all())

@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.get_json() or {}
    for k, v in data.items():
        Setting.set(k, str(v))
    return jsonify(Setting.get_all())

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
