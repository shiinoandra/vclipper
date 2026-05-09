import yt_dlp
import subprocess
import os
import time

url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
start_time = 60  # 1 minute in
duration = 10    # 10 seconds clip
output_dir = "./test_downloads"
os.makedirs(output_dir, exist_ok=True)
final_path = os.path.join(output_dir, "test_clip.mp4")

fmt = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]"

# Extract URLs
info_opts = {
    "format": fmt,
    "quiet": True,
    "no_warnings": True,
}

with yt_dlp.YoutubeDL(info_opts) as ydl:
    info = ydl.extract_info(url, download=False)

formats = info.get("requested_formats") or info.get("formats", [])
video_url = None
audio_url = None
for f in formats:
    vcodec = f.get("vcodec", "none")
    acodec = f.get("acodec", "none")
    if vcodec != "none" and not video_url:
        video_url = f.get("url")
        print(f"Video: format_id={f.get('format_id')} resolution={f.get('resolution')} height={f.get('height')} width={f.get('width')}")
    if acodec != "none" and not audio_url:
        audio_url = f.get("url")
        print(f"Audio: format_id={f.get('format_id')} resolution={f.get('resolution')}")

print(f"\nVideo URL length: {len(video_url or '')}")
print(f"Audio URL length: {len(audio_url or '')}")

# Build ffmpeg command
cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
cmd += [
    "-seekable", "1",
    "-multiple_requests", "1",
    "-request_size", "10000000",
    "-ss", str(start_time),
    "-t", str(duration),
    "-i", video_url,
]
if audio_url:
    cmd += [
        "-seekable", "1",
        "-multiple_requests", "1",
        "-request_size", "10000000",
        "-ss", str(start_time),
        "-t", str(duration),
        "-i", audio_url,
    ]
cmd += ["-c", "copy"]
if audio_url:
    cmd += ["-map", "0:v:0", "-map", "1:a:0"]
cmd += [
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    final_path,
]

print(f"\nFFmpeg command:\n{' '.join(cmd[:20])} ...")

start = time.time()
result = subprocess.run(cmd, capture_output=True, text=True)
elapsed = time.time() - start

print(f"\nFFmpeg completed in {elapsed:.1f}s")
print(f"Return code: {result.returncode}")
if result.stderr:
    print(f"Stderr: {result.stderr[:500]}")

if os.path.exists(final_path):
    size = os.path.getsize(final_path)
    print(f"Output file: {size} bytes")
    
    # Check resolution with ffprobe
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,codec_name,bit_rate",
         "-of", "default=noprint_wrappers=1", final_path],
        capture_output=True, text=True
    )
    print(f"\nStream info:\n{probe.stdout}")
else:
    print("Output file not created!")
