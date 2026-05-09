import yt_dlp
import subprocess
import os

# Test URL — Rick Astley has 720p available
url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 1. Extract info with our format string
fmt = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]"

ydl_opts = {
    "format": fmt,
    "quiet": True,
    "no_warnings": True,
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    
    print("=== Full info keys ===")
    print(list(info.keys())[:30])
    
    print("\n=== requested_formats ===")
    rf = info.get("requested_formats", [])
    for f in rf:
        print(f"  format_id={f.get('format_id')} resolution={f.get('resolution')} ext={f.get('ext')} vcodec={f.get('vcodec')} acodec={f.get('acodec')} height={f.get('height')} width={f.get('width')} url_len={len(f.get('url', ''))}")
    
    print("\n=== All formats ===")
    for f in info.get("formats", [])[:15]:
        print(f"  {f.get('format_id'):>5} {f.get('resolution', 'audio'):>10} {f.get('ext'):>4} v={f.get('vcodec', 'none'):>12} a={f.get('acodec', 'none'):>12} h={f.get('height', 'N/A')}")
    
    # Check what the actual selected format looks like
    if rf:
        video_f = [f for f in rf if f.get('vcodec') != 'none'][0] if any(f.get('vcodec') != 'none' for f in rf) else rf[0]
        print(f"\n=== Selected video format ===")
        print(f"  format_id: {video_f.get('format_id')}")
        print(f"  resolution: {video_f.get('resolution')}")
        print(f"  width: {video_f.get('width')}")
        print(f"  height: {video_f.get('height')}")
        print(f"  ext: {video_f.get('ext')}")
        print(f"  vcodec: {video_f.get('vcodec')}")
        print(f"  acodec: {video_f.get('acodec')}")
        print(f"  url starts with: {video_f.get('url', '')[:100]}...")
        print(f"  protocol: {video_f.get('protocol')}")
        print(f"  container: {video_f.get('container')}")
        print(f"  quality: {video_f.get('quality')}")
        print(f"  quality_label: {video_f.get('quality_label')}")
        print(f"  source_preference: {video_f.get('source_preference')}")
