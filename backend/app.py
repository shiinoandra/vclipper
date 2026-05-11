import os
import time
import threading
import re
import subprocess
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from config import Config
from models import db, Clip, Setting, TrackedChannel, LiveStream, StreamSummary, StreamMoment

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


def _resolve_format(quality, settings):
    """Resolve 'default' to a yt-dlp format string with MP4/M4A preference for efficient ffmpeg seeking.
    
    Uses separate DASH streams (bestvideo+bestaudio) for quality.
    Forces MP4/M4A containers because ffmpeg HTTP seeking is much faster on MP4 than WebM.
    Audio is always bestaudio[ext=m4a] — output bitrate is controlled separately via ffmpeg.
    """
    q = quality or settings.get("default_quality", "default")

    # Resolve 'default' to hardcoded safe value
    if q == "default":
        q = "bestvideo[height<=720]"

    # Pure audio-only selection (e.g. "bestaudio")
    if q.startswith("bestaudio") or q.startswith("worstaudio"):
        return f"{q}[ext=m4a]/{q}"

    # Convert combined-format selectors to video-only so we can pair them with audio.
    def _to_video_selector(fmt):
        if fmt.startswith("bestvideo") or fmt.startswith("worstvideo"):
            return fmt
        if fmt == "best":
            return "bestvideo"
        if fmt == "worst":
            return "worstvideo"
        if fmt.startswith("best["):
            return fmt.replace("best[", "bestvideo[", 1)
        if fmt.startswith("worst["):
            return fmt.replace("worst[", "worstvideo[", 1)
        return fmt

    video_sel = _to_video_selector(q)

    # Always pick best audio in M4A container. Output bitrate is set by ffmpeg -b:a.
    return f"{video_sel}[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"


def _resolve_audio_bitrate(clip, settings):
    """Return audio bitrate in kbps for ffmpeg -b:a."""
    br = clip.audio_bitrate or settings.get("default_audio_bitrate", "128")
    try:
        int(br)
        return br
    except (ValueError, TypeError):
        return "128"


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


def _safe_filename(title: str) -> str:
    """Sanitize a string for use as a filesystem filename."""
    import re
    safe = re.sub(r'[^\w\s-]', '', title or "Untitled")
    safe = re.sub(r'[-\s]+', '_', safe).strip('_')
    return safe[:80] or "Untitled"


def _build_output_path(clip, output_dir):
    """Build output filename as <title>_<start>_<end>.mp4"""
    safe_title = _safe_filename(clip.title)
    start_sec = int(clip.start_time)
    end_sec = int(clip.end_time)
    filename = f"{safe_title}_{start_sec}_{end_sec}.mp4"
    return os.path.join(output_dir, filename)


def _extract_media_info(info, clip):
    """Extract resolution and audio codec from yt-dlp info dict."""
    requested = info.get("requested_formats", [])
    if len(requested) >= 1:
        # DASH or single format
        video_fmt = requested[0] if requested[0].get("vcodec") != "none" else (requested[1] if len(requested) > 1 else requested[0])
        audio_fmt = None
        for f in requested:
            if f.get("acodec") != "none":
                audio_fmt = f
                break
        width = video_fmt.get("width") or info.get("width")
        height = video_fmt.get("height") or info.get("height")
        resolution = f"{width}x{height}" if width and height else None
        audio_codec = audio_fmt.get("acodec") if audio_fmt else None
    else:
        resolution = f"{info.get('width')}x{info.get('height')}" if info.get("width") and info.get("height") else None
        audio_codec = info.get("acodec")
    return resolution, audio_codec


def _detect_cc(output_path):
    """Check if a .srt subtitle file exists next to the video."""
    if not output_path:
        return False
    srt_path = os.path.splitext(output_path)[0] + ".srt"
    return os.path.exists(srt_path) and os.path.getsize(srt_path) > 0


def _ffmpeg_seek_download(clip, fmt, output_dir, cancel_event, audio_bitrate):
    """Strategy A: Two-step window download for perfect A/V sync.

    Step 1 — Download a padded window (start-10s to end+10s) via ffmpeg
             with -c:v copy and -c:a aac. Audio re-encode forces fresh
             timestamps aligned to the video timeline, eliminating DASH
             seek-point drift.

    Step 2 — Local -c copy cut from the synced window file. Since the
             window is a local file with correct sync, the cut is exact.

    Returns the output file path on success, raises Exception on failure.
    """
    import yt_dlp

    duration = clip.end_time - clip.start_time
    window_pad = 10.0  # seconds of padding before / after target segment
    window_start = max(0.0, clip.start_time - window_pad)
    window_duration = duration + (window_pad * 2)
    cut_offset = clip.start_time - window_start

    tmp_window = os.path.join(output_dir, f"_window_{clip.id}.mp4")
    tmp_path = os.path.join(output_dir, f"_clip_{clip.id}.mp4")

    # Clean up stale files
    for f in [tmp_window, tmp_path]:
        if os.path.exists(f):
            os.remove(f)

    # 1. Extract format URLs without downloading
    info_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(info_opts) as ydl:
        info = ydl.extract_info(clip.youtube_url, download=False)
        requested = info.get("requested_formats", [])

        def _get_direct_url(fmt_info):
            url = fmt_info.get("url")
            if url:
                return url
            fragment_base = fmt_info.get("fragment_base_url")
            if fragment_base:
                return fragment_base
            return None

        video_url = None
        audio_url = None

        if requested:
            video_fmts = [f for f in requested if f.get("vcodec", "none") != "none"]
            audio_fmts = [f for f in requested if f.get("acodec", "none") != "none"]
            if video_fmts:
                video_url = _get_direct_url(video_fmts[0])
            if audio_fmts:
                audio_url = _get_direct_url(audio_fmts[0])
            if not video_url and requested:
                video_url = _get_direct_url(requested[0])
        elif info.get("url"):
            video_url = info["url"]

        if not video_url:
            raise Exception("Strategy A: no format URL available from yt-dlp")

        print(f"[Strategy A] Video URL: {video_url[:80]}...")
        if audio_url:
            print(f"[Strategy A] Audio URL: {audio_url[:80]}...")
        else:
            print("[Strategy A] Using combined format (no separate audio)")

        clip.title = info.get("title", clip.title or "Untitled")
        resolution, audio_codec = _extract_media_info(info, clip)
        clip.video_resolution = resolution
        clip.audio_codec = audio_codec

    # ── Step 1: Download padded window with audio re-encode ──
    window_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+discardcorrupt",
        "-rw_timeout", "10000000",
        "-ss", str(window_start),
        "-t", str(window_duration),
        "-i", video_url,
    ]
    if audio_url:
        window_cmd += [
            "-ss", str(window_start),
            "-t", str(window_duration),
            "-i", audio_url,
        ]

    # Re-encode audio to AAC — this generates fresh timestamps aligned
    # to the video timeline, eliminating DASH seek-point drift.
    window_cmd += [
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", f"{audio_bitrate}k",
    ]
    if audio_url:
        window_cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    window_cmd += [
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        "-shortest",
        tmp_window,
    ]

    print(f"[Strategy A] Step 1: window {window_start:.1f}s - {window_start+window_duration:.1f}s (pad={window_pad}s)")

    proc = subprocess.Popen(window_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    start_time = time.time()
    max_wait_seconds = 180  # 3 min — window is only slightly larger than clip
    last_size = 0
    stalled_count = 0

    while proc.poll() is None:
        if cancel_event.is_set():
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            for f in [tmp_window, tmp_path]:
                if os.path.exists(f):
                    os.remove(f)
            raise Exception("Cancelled by user")

        elapsed = time.time() - start_time

        if elapsed > max_wait_seconds:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            for f in [tmp_window, tmp_path]:
                if os.path.exists(f):
                    os.remove(f)
            raise Exception(f"Strategy A window download timed out after {max_wait_seconds}s")

        if os.path.exists(tmp_window):
            current_size = os.path.getsize(tmp_window)
            if current_size == last_size:
                stalled_count += 1
            else:
                stalled_count = 0
                last_size = current_size
            if stalled_count > 30:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                os.remove(tmp_window)
                raise Exception("Strategy A window download stalled")

        _set_progress(clip.id, str(min(70, int(elapsed * 2))))
        time.sleep(0.5)

    stdout, stderr_data = proc.communicate(timeout=5)

    if proc.returncode != 0:
        err_text = stderr_data.decode("utf-8", errors="ignore").strip()[:500]
        for f in [tmp_window, tmp_path]:
            if os.path.exists(f):
                os.remove(f)
        raise Exception(f"Strategy A window download failed: {err_text}")

    if not os.path.exists(tmp_window) or os.path.getsize(tmp_window) < 1024:
        raise Exception("Strategy A window output missing or empty")

    print(f"[Strategy A] Window file: {os.path.getsize(tmp_window)} bytes")

    # ── Step 2: Local frame-accurate cut from synced window ──
    cut_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(cut_offset),
        "-t", str(duration),
        "-i", tmp_window,
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        tmp_path,
    ]

    print(f"[Strategy A] Step 2: local cut offset={cut_offset:.3f}s duration={duration:.1f}s")

    result = subprocess.run(cut_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    if result.returncode != 0:
        err_text = result.stderr.decode("utf-8", errors="ignore").strip()[:500]
        for f in [tmp_window, tmp_path]:
            if os.path.exists(f):
                os.remove(f)
        raise Exception(f"Strategy A local cut failed: {err_text}")

    if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 1024:
        for f in [tmp_window, tmp_path]:
            if os.path.exists(f):
                os.remove(f)
        raise Exception("Strategy A local cut output missing or empty")

    print(f"[Strategy A] Success: {os.path.getsize(tmp_path)} bytes")

    # Clean up window file
    try:
        os.remove(tmp_window)
    except OSError:
        pass

    # Rename to final filename
    final_path = _build_output_path(clip, output_dir)
    if os.path.exists(final_path):
        os.remove(final_path)
    os.rename(tmp_path, final_path)
    return final_path


def _full_download_then_cut(clip, fmt, output_dir, cancel_event, audio_bitrate):
    """Strategy B (fallback): Download full video with yt-dlp, then ffmpeg-cut.
    Returns the output file path."""
    import yt_dlp

    tmp_outtmpl = os.path.join(output_dir, f"_full_{clip.id}_%(title).100B.%(ext)s")
    tmp_cut_path = os.path.join(output_dir, f"_clip_{clip.id}.mp4")
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
        clip.title = info.get("title", clip.title or "Untitled")
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

        # Extract media metadata
        resolution, audio_codec = _extract_media_info(info, clip)
        clip.video_resolution = resolution
        clip.audio_codec = audio_codec

    if cancel_event.is_set():
        raise Exception("Cancelled by user")

    if not full_path or not os.path.exists(full_path):
        raise Exception("Download failed: full video not found")

    ffmpeg_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(clip.start_time),
        "-t", str(duration),
        "-i", full_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", f"{audio_bitrate}k",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        "-shortest",
        tmp_cut_path,
    ]
    subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not os.path.exists(tmp_cut_path):
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

    # Rename to final filename
    final_path = _build_output_path(clip, output_dir)
    if os.path.exists(final_path):
        os.remove(final_path)
    os.rename(tmp_cut_path, final_path)
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
            fmt = _resolve_format(clip.quality, settings)
            audio_bitrate = _resolve_audio_bitrate(clip, settings)

            # Try Strategy A (smart ffmpeg seek) first
            _set_progress(clip_id, "5")
            try:
                output_path = _ffmpeg_seek_download(clip, fmt, output_dir, cancel_event, audio_bitrate)
            except Exception as seek_err:
                print(f"[Strategy A FAILED] clip_id={clip_id}: {seek_err}")
                print(f"[Strategy A → B FALLBACK] clip_id={clip_id}: switching to full download + cut")
                # Fallback to Strategy B (full download then cut)
                _set_progress(clip_id, "0")
                output_path = _full_download_then_cut(clip, fmt, output_dir, cancel_event, audio_bitrate)
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
                # Keep fallback info visible so user knows Strategy A was skipped
                if clip.error_message and "fell back to full download" in clip.error_message:
                    pass  # preserve it
                else:
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
        audio_bitrate = item.get("audio_bitrate") or settings.get("default_audio_bitrate", "128")

        clip = Clip(
            youtube_url=url,
            start_time=start,
            end_time=end,
            quality=quality,
            video_codec=item.get("video_codec") or settings.get("default_video_codec", None),
            audio_bitrate=audio_bitrate,
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

@app.route("/api/clips/<int:clip_id>/download")
def download_clip(clip_id):
    """Serve the clipped video file as a downloadable attachment."""
    clip = Clip.query.get_or_404(clip_id)
    if not clip.output_path or not os.path.exists(clip.output_path):
        return jsonify({"error": "File not found"}), 404
    from flask import send_file
    return send_file(clip.output_path, as_attachment=True)


@app.route("/api/clips/<int:clip_id>/watch")
def watch_clip(clip_id):
    """Serve the clipped video file for inline viewing."""
    clip = Clip.query.get_or_404(clip_id)
    if not clip.output_path or not os.path.exists(clip.output_path):
        return jsonify({"error": "File not found"}), 404
    from flask import send_file
    return send_file(clip.output_path)


@app.route("/api/clips/<int:clip_id>/subtitles", methods=["GET"])
def get_clip_subtitles(clip_id):
    """Return the SRT subtitle content for a clip, or empty string if none exists."""
    clip = Clip.query.get_or_404(clip_id)

    # Determine SRT path: same base name as video, but .srt
    if clip.output_path:
        srt_path = os.path.splitext(clip.output_path)[0] + ".srt"
    else:
        # Derive path from title/start/end if output_path missing
        output_dir = os.path.abspath(clip.output_dir or Config.DEFAULT_OUTPUT_DIR)
        safe_title = _safe_filename(clip.title)
        srt_path = os.path.join(output_dir, f"{safe_title}_{int(clip.start_time)}_{int(clip.end_time)}.srt")

    if os.path.exists(srt_path):
        with open(srt_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(), 200, {"Content-Type": "text/plain; charset=utf-8"}
    return "", 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/api/clips/<int:clip_id>/subtitles", methods=["PUT"])
def update_clip_subtitles(clip_id):
    """Save SRT subtitle content for a clip."""
    clip = Clip.query.get_or_404(clip_id)
    content = request.get_data(as_text=True)

    if content is None:
        return jsonify({"error": "No content provided"}), 400

    # Determine SRT path
    if clip.output_path:
        srt_path = os.path.splitext(clip.output_path)[0] + ".srt"
    else:
        output_dir = os.path.abspath(clip.output_dir or Config.DEFAULT_OUTPUT_DIR)
        os.makedirs(output_dir, exist_ok=True)
        safe_title = _safe_filename(clip.title)
        srt_path = os.path.join(output_dir, f"{safe_title}_{int(clip.start_time)}_{int(clip.end_time)}.srt")

    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(content)

    # Update has_cc flag
    clip.has_cc = bool(content.strip())
    db.session.commit()

    return jsonify({"saved": True, "path": srt_path})


# ─── AI Transcription ───

def _split_text_to_srt(text: str, start_sec: float, end_sec: float) -> str:
    """Split plain transcript text into SRT segments with proportional timestamps.

    Splits on sentence boundaries (。！？.!?) and distributes time by character
    count so longer sentences get proportionally more screen time.
    """
    import re

    text = text.strip()
    if not text:
        return ""

    # Split on sentence-ending punctuation, keeping the punctuation with the sentence
    sentences = re.split(r'(?<=[。！？\.\?!])\s*', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        sentences = [text]

    total_chars = sum(len(s) for s in sentences)
    total_duration = max(end_sec - start_sec, 1.0)

    entries = []
    current_time = start_sec
    for i, sentence in enumerate(sentences, start=1):
        # Proportional duration based on character count
        ratio = len(sentence) / total_chars if total_chars > 0 else 1.0 / len(sentences)
        seg_duration = ratio * total_duration

        # Clamp segment duration for readability
        seg_duration = max(seg_duration, 1.0)
        seg_duration = min(seg_duration, 8.0)

        seg_start = current_time
        seg_end = min(seg_start + seg_duration, end_sec)

        # Ensure last segment reaches the end
        if i == len(sentences):
            seg_end = end_sec

        entries.append({
            "index": i,
            "start": seg_start,
            "end": seg_end,
            "text": sentence,
        })
        current_time = seg_end

    lines = []
    for e in entries:
        lines.append(str(e["index"]))
        lines.append(f"{_format_srt_time(e['start'])} --> {_format_srt_time(e['end'])}")
        lines.append(e["text"])
        lines.append("")

    return "\n".join(lines)


@app.route("/api/clips/<int:clip_id>/transcribe", methods=["POST"])
def transcribe_clip(clip_id):
    """Extract audio from a completed clip, send to transcription provider, save SRT."""
    import requests
    import tempfile

    clip = Clip.query.get_or_404(clip_id)

    if clip.status != "completed" or not clip.output_path or not os.path.exists(clip.output_path):
        return jsonify({"error": "Clip not available for transcription"}), 400

    # Read transcription settings
    provider_url = (Setting.get("transcription_provider_url") or "").strip()
    api_key = (Setting.get("transcription_api_key") or "").strip()
    model = (Setting.get("transcription_model") or "").strip()
    default_language = (Setting.get("transcription_language") or "").strip()

    # Allow per-request language override
    req_data = request.get_json(silent=True) or {}
    language = (req_data.get("language") or default_language).strip()

    if not provider_url:
        return jsonify({"error": "Transcription provider URL not configured. Set it in Settings."}), 400

    # Determine SRT path
    srt_path = os.path.splitext(clip.output_path)[0] + ".srt"

    # Extract audio to temporary file (16kHz mono WAV — compatible with most ASR models)
    tmp_audio = None
    try:
        fd, tmp_audio = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        ffmpeg_cmd = [
            "ffmpeg", "-y", "-i", clip.output_path,
            "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            tmp_audio,
        ]
        proc = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return jsonify({"error": f"ffmpeg audio extraction failed: {proc.stderr}"}), 500

        # Call transcription API
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        with open(tmp_audio, "rb") as af:
            files = {"file": ("audio.wav", af, "audio/wav")}
            data = {"response_format": "srt"}
            if model:
                data["model"] = model
            if language:
                data["language"] = language

            try:
                resp = requests.post(
                    f"{provider_url.rstrip('/')}/v1/audio/transcriptions",
                    headers=headers,
                    files=files,
                    data=data,
                    timeout=300,
                )
            except requests.exceptions.ConnectionError as e:
                return jsonify({"error": f"Cannot connect to transcription provider: {e}"}), 502
            except requests.exceptions.Timeout:
                return jsonify({"error": "Transcription provider timed out"}), 504

        if resp.status_code != 200:
            return jsonify({"error": f"Transcription API error {resp.status_code}: {resp.text}"}), 502

        # Handle SRT response (plain text or JSON fallback)
        content_type = resp.headers.get("Content-Type", "")
        if content_type.startswith("text/plain") or content_type.startswith("application/x-subrip"):
            srt_content = resp.text.strip()
        else:
            # Fallback: try JSON with text field
            try:
                result = resp.json()
                if isinstance(result, str):
                    srt_content = result.strip()
                else:
                    srt_content = result.get("text", "").strip()
                    if srt_content:
                        srt_content = _split_text_to_srt(srt_content, 0.0, clip.end_time - clip.start_time)
            except Exception:
                srt_content = resp.text.strip()

        if not srt_content:
            return jsonify({"error": "Transcription returned empty subtitles (no speech detected)."}), 500

        # Save SRT
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)

        # Update has_cc flag
        clip.has_cc = True
        db.session.commit()

        # Extract plain transcript from SRT for the response
        transcript_text = " ".join(
            line.strip()
            for line in srt_content.splitlines()
            if line.strip() and not line.strip().isdigit()
            and "-->" not in line
        )

        return jsonify({
            "success": True,
            "transcript": transcript_text,
            "srt": srt_content,
            "path": srt_path,
        })

    finally:
        if tmp_audio and os.path.exists(tmp_audio):
            try:
                os.remove(tmp_audio)
            except OSError:
                pass


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


# ─── Tracked Channels ───

@app.route("/api/channels", methods=["GET"])
def list_channels():
    channels = TrackedChannel.query.order_by(TrackedChannel.channel_name).all()
    return jsonify([c.to_dict() for c in channels])


def _extract_channel_id_from_url(url: str) -> str | None:
    """Parse a YouTube URL and return a canonical channel page URL."""
    import re

    # Channel ID directly: /channel/UC...
    m = re.search(r"youtube\.com/channel/(UC[\w-]+)", url)
    if m:
        return m.group(1)

    # Handle: @name
    m = re.search(r"youtube\.com/@([\w.]+)", url)
    if m:
        return f"@{m.group(1)}"

    # Custom URL: /c/Name or /user/Name
    m = re.search(r"youtube\.com/(c|user)/([\w.]+)", url)
    if m:
        return f"{m.group(1)}/{m.group(2)}"

    # Video URL — can't extract channel from URL alone, return None to signal yt-dlp needed
    return None


@app.route("/api/channels", methods=["POST"])
def add_channel():
    import yt_dlp
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    channel_id = None
    channel_name = None
    avatar_url = None

    # Try to extract channel identifier from URL patterns first
    channel_ident = _extract_channel_id_from_url(url)

    if channel_ident:
        # Build a canonical channel videos page URL
        if channel_ident.startswith("UC"):
            channel_url = f"https://www.youtube.com/channel/{channel_ident}/videos"
        elif channel_ident.startswith("@"):
            channel_url = f"https://www.youtube.com/{channel_ident}/videos"
        else:
            channel_url = f"https://www.youtube.com/{channel_ident}/videos"

        # Extract channel metadata via yt-dlp on the channel page
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "playlistend": 1,
            "ignore_no_formats_error": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(channel_url, download=False)
        except Exception as e:
            return jsonify({"error": f"Could not fetch channel: {e}"}), 400

        channel_id = info.get("channel_id") or info.get("uploader_id")
        channel_name = info.get("channel") or info.get("uploader")
        avatar_url = info.get("thumbnails", [{}])[-1].get("url", "") if info.get("thumbnails") else ""

    else:
        # Fallback: try the original URL (might be a video URL).
        # Use ignore_no_formats_error so restricted videos don't blow up.
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "ignore_no_formats_error": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            return jsonify({"error": f"Could not extract info: {e}"}), 400

        channel_id = info.get("channel_id") or info.get("uploader_id")
        channel_name = info.get("channel") or info.get("uploader")
        avatar_url = info.get("thumbnails", [{}])[-1].get("url", "") if info.get("thumbnails") else ""

    if not channel_id or not channel_id.startswith("UC"):
        return jsonify({"error": "Could not extract valid YouTube channel ID"}), 400

    # Check for duplicate
    existing = TrackedChannel.query.filter_by(channel_id=channel_id).first()
    if existing:
        return jsonify(existing.to_dict()), 200

    channel = TrackedChannel(
        channel_id=channel_id,
        channel_name=channel_name or channel_id,
        avatar_url=avatar_url or "",
    )
    db.session.add(channel)
    db.session.commit()

    # Trigger an immediate poll for this channel's streams in the background
    def _poll_new_channel():
        with app.app_context():
            try:
                _check_channel_uploads(channel)
                print(f"[Poller] Immediate poll completed for {channel.channel_name}")
            except Exception as e:
                print(f"[Poller] Immediate poll failed for {channel.channel_name}: {e}")

    threading.Thread(target=_poll_new_channel, daemon=True).start()

    return jsonify(channel.to_dict()), 201


@app.route("/api/channels/<int:channel_db_id>", methods=["PUT"])
def update_channel(channel_db_id):
    import json
    channel = TrackedChannel.query.get_or_404(channel_db_id)
    data = request.get_json() or {}
    tags = data.get("tags")
    if tags is not None:
        if isinstance(tags, list):
            channel.tags = json.dumps(tags)
        elif isinstance(tags, str):
            channel.tags = tags
    db.session.commit()
    return jsonify(channel.to_dict())


@app.route("/api/channels/<int:channel_db_id>", methods=["DELETE"])
def delete_channel(channel_db_id):
    channel = TrackedChannel.query.get_or_404(channel_db_id)
    # Also delete associated streams
    LiveStream.query.filter_by(channel_id=channel.id).delete()
    db.session.delete(channel)
    db.session.commit()
    return jsonify({"deleted": True})


# ─── Live Streams ───

@app.route("/api/live", methods=["GET"])
def list_live_streams():
    """Return live streams grouped by date. Optional ?tag= filter."""
    from datetime import datetime, timedelta
    import json

    tag = request.args.get("tag", "").strip()

    # Show streams from last 3 days + currently live + upcoming
    cutoff = datetime.utcnow() - timedelta(days=3)

    q = LiveStream.query.filter(
        (LiveStream.status == "live") |
        (LiveStream.status == "upcoming") |
        (LiveStream.actual_start >= cutoff)
    )

    # Filter by tag if provided
    if tag:
        channels = TrackedChannel.query.all()
        matching_channel_ids = []
        for ch in channels:
            try:
                ch_tags = json.loads(ch.tags or "[]")
                if isinstance(ch_tags, list) and tag in ch_tags:
                    matching_channel_ids.append(ch.id)
            except (json.JSONDecodeError, TypeError):
                continue
        q = q.filter(LiveStream.channel_id.in_(matching_channel_ids))

    streams = q.order_by(LiveStream.actual_start.desc().nullsfirst(), LiveStream.scheduled_start.desc().nullsfirst()).all()

    # Group by date:
    # - upcoming streams use scheduled_start (the planned go-live date)
    # - live/ended streams use actual_start (the real start time)
    groups = {}
    for s in streams:
        if s.status == "upcoming":
            dt = s.scheduled_start or s.actual_start
        else:
            dt = s.actual_start or s.scheduled_start
        if not dt:
            continue
        date_key = dt.strftime("%Y-%m-%d")
        if date_key not in groups:
            groups[date_key] = []
        groups[date_key].append(s.to_dict())

    # Sort dates descending
    sorted_groups = [
        {"date": k, "streams": groups[k]}
        for k in sorted(groups.keys(), reverse=True)
    ]
    return jsonify(sorted_groups)


# ─── Live Stream Poller ───

_live_poller_thread = None
_live_poller_stop = threading.Event()


def _poll_live_streams():
    import yt_dlp
    from datetime import datetime, timezone

    while not _live_poller_stop.is_set():
        try:
            with app.app_context():
                channels = TrackedChannel.query.all()
                for channel in channels:
                    if _live_poller_stop.is_set():
                        break
                    try:
                        _check_channel_uploads(channel)
                    except Exception as e:
                        print(f"[Poller] Error checking channel {channel.channel_id}: {e}")
        except Exception as e:
            print(f"[Poller] Error: {e}")

        # Sleep for 5 minutes, checking stop event every second
        for _ in range(300):
            if _live_poller_stop.is_set():
                break
            time.sleep(1)


def _process_channel_entries(channel, entries):
    """Process a list of yt-dlp entries and upsert LiveStream records."""
    from datetime import datetime, timezone

    for entry in entries:
        if not entry or not entry.get("id"):
            continue

        video_id = entry["id"]
        live_status = entry.get("live_status")  # 'is_live', 'was_live', 'is_upcoming', 'not_live'
        is_live = entry.get("is_live", False)

        # Skip regular uploads that were never live
        if live_status == "not_live" and not is_live:
            continue

        # Determine stream status
        if is_live or live_status == "is_live":
            status = "live"
        elif live_status == "is_upcoming":
            status = "upcoming"
        else:
            status = "ended"

        # Parse timestamps
        actual_start = None
        actual_end = None
        scheduled_start = None

        ts = entry.get("timestamp")
        release_ts = entry.get("release_timestamp")

        if status == "upcoming":
            # For upcoming streams, timestamp is creation time — ignore it.
            # Use release_timestamp as the scheduled start.
            if release_ts:
                scheduled_start = datetime.fromtimestamp(release_ts, tz=timezone.utc).replace(tzinfo=None)
        else:
            # For live/ended streams, timestamp is the actual start time.
            if ts:
                actual_start = datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
            if release_ts:
                scheduled_start = datetime.fromtimestamp(release_ts, tz=timezone.utc).replace(tzinfo=None)

        # For ended streams, estimate end time
        if status == "ended" and actual_start:
            duration = entry.get("duration", 0)
            if duration and ts:
                actual_end = datetime.fromtimestamp(ts + duration, tz=timezone.utc).replace(tzinfo=None)

        # Upsert live stream record
        stream = LiveStream.query.filter_by(video_id=video_id).first()
        if stream:
            stream.status = status
            if actual_start:
                stream.actual_start = actual_start
            if actual_end:
                stream.actual_end = actual_end
            if scheduled_start:
                stream.scheduled_start = scheduled_start
            stream.title = entry.get("title", stream.title)
            stream.thumbnail_url = entry.get("thumbnail", stream.thumbnail_url)
        else:
            stream = LiveStream(
                video_id=video_id,
                channel_id=channel.id,
                title=entry.get("title", ""),
                thumbnail_url=entry.get("thumbnail", ""),
                scheduled_start=scheduled_start,
                actual_start=actual_start,
                actual_end=actual_end,
                status=status,
                video_url=f"https://www.youtube.com/watch?v={video_id}",
            )
            db.session.add(stream)

    db.session.commit()


def _check_channel_uploads(channel):
    """Check /streams tab first (live/upcoming), then /videos (uploads).
    Uses ignore_no_formats_error so future/upcoming streams don't crash extraction."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "playlistend": 15,
        "extract_flat": False,
        "ignore_no_formats_error": True,
    }

    # 1. Check /streams tab — this is where live and upcoming streams appear
    streams_url = f"https://www.youtube.com/channel/{channel.channel_id}/streams"
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(streams_url, download=False)
        entries = info.get("entries", [])
        if entries:
            _process_channel_entries(channel, entries)
            return
    except Exception as e:
        print(f"[Poller] /streams failed for {channel.channel_id}: {e}")

    # 2. Fallback to /videos tab
    videos_url = f"https://www.youtube.com/channel/{channel.channel_id}/videos"
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(videos_url, download=False)
        entries = info.get("entries", [])
        if entries:
            _process_channel_entries(channel, entries)
    except Exception as e:
        print(f"[Poller] /videos failed for {channel.channel_id}: {e}")


# ─── Stream Summaries & Moments ───

@app.route("/api/streams/<video_id>/summary", methods=["GET"])
def get_stream_summary(video_id):
    summary = StreamSummary.query.filter_by(video_id=video_id).first()
    if summary:
        return jsonify(summary.to_dict())
    # Return empty placeholder
    return jsonify({"video_id": video_id, "summary_text": ""})


@app.route("/api/streams/<video_id>/summary", methods=["PUT"])
def update_stream_summary(video_id):
    data = request.get_json() or {}
    text = data.get("summary_text", "")

    summary = StreamSummary.query.filter_by(video_id=video_id).first()
    if summary:
        summary.summary_text = text
    else:
        summary = StreamSummary(video_id=video_id, summary_text=text)
        db.session.add(summary)
    db.session.commit()
    return jsonify(summary.to_dict())


@app.route("/api/streams/<video_id>/moments", methods=["GET"])
def list_stream_moments(video_id):
    moments = StreamMoment.query.filter_by(video_id=video_id).order_by(StreamMoment.start_time).all()
    return jsonify([m.to_dict() for m in moments])


@app.route("/api/streams/<video_id>/moments", methods=["POST"])
def add_stream_moment(video_id):
    data = request.get_json() or {}
    start = data.get("start_time")
    end = data.get("end_time")
    desc = data.get("description", "")

    if start is None or end is None:
        return jsonify({"error": "start_time and end_time are required"}), 400

    try:
        start = float(start)
        end = float(end)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid time values"}), 400

    if end <= start:
        return jsonify({"error": "end_time must be greater than start_time"}), 400

    moment = StreamMoment(
        video_id=video_id,
        start_time=start,
        end_time=end,
        description=desc,
    )
    db.session.add(moment)
    db.session.commit()
    return jsonify(moment.to_dict()), 201


@app.route("/api/streams/moments/<int:moment_id>", methods=["DELETE"])
def delete_stream_moment(moment_id):
    moment = StreamMoment.query.get_or_404(moment_id)
    db.session.delete(moment)
    db.session.commit()
    return jsonify({"deleted": True})


# ─── Poller ───

def _start_live_poller():
    global _live_poller_thread
    if _live_poller_thread is None or not _live_poller_thread.is_alive():
        _live_poller_stop.clear()
        _live_poller_thread = threading.Thread(target=_poll_live_streams, daemon=True)
        _live_poller_thread.start()
        print("[Poller] Live stream poller started")


# Start the poller when the app initializes
_start_live_poller()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
