import { useEffect, useRef, useCallback } from 'react';

interface YouTubePlayerProps {
  videoId: string;
  onTimeUpdate?: (time: number) => void;
  onReady?: (api: { seekTo: (t: number) => void; getCurrentTime: () => number; getDuration: () => number; playVideo: () => void; pauseVideo: () => void }) => void;
}

export default function YouTubePlayer({ videoId, onTimeUpdate, onReady }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const seekTo = useCallback((time: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(time, true);
    }
  }, []);

  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime?.() ?? 0;
  }, []);

  const getDuration = useCallback(() => {
    return playerRef.current?.getDuration?.() ?? 0;
  }, []);

  const playVideo = useCallback(() => {
    playerRef.current?.playVideo?.();
  }, []);

  const pauseVideo = useCallback(() => {
    playerRef.current?.pauseVideo?.();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const initPlayer = () => {
      // @ts-ignore
      if (!window.YT) return;
      // @ts-ignore
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            onReady?.({ seekTo, getCurrentTime, getDuration, playVideo, pauseVideo });
            intervalRef.current = setInterval(() => {
              const t = getCurrentTime();
              onTimeUpdate?.(t);
            }, 500);
          },
        },
      });
    };

    // @ts-ignore
    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      // @ts-ignore
      window.onYouTubeIframeAPIReady = initPlayer;
      if (!document.getElementById('yt-api')) {
        const tag = document.createElement('script');
        tag.id = 'yt-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      try {
        playerRef.current?.destroy?.();
      } catch {}
    };
  }, [videoId]);

  return <div ref={containerRef} style={{ width: '100%', aspectRatio: '16/9', background: '#000' }} />;
}
