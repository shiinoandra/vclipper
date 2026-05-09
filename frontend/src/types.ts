export interface Clip {
  id: number;
  youtube_url: string;
  title?: string;
  start_time: number;
  end_time: number;
  quality: string;
  video_codec?: string;
  audio_quality?: string;
  download_thumbnail: boolean;
  download_cc: boolean;
  output_dir: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  output_path?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ClipSegment {
  id: string;
  start: number;
  end: number;
  color: string;
  quality: string;
  audioQuality: string;
  downloadCC: boolean;
}

export interface Settings {
  default_quality?: string;
  default_video_codec?: string;
  default_audio_quality?: string;
  download_thumbnail?: string;
  default_output_dir?: string;
  [key: string]: string | undefined;
}

export interface TrackedChannel {
  id: number;
  channel_id: string;
  channel_name?: string;
  avatar_url?: string;
  created_at?: string;
}

export interface LiveStream {
  id: number;
  video_id: string;
  channel_id: number;
  channel_name?: string;
  channel_avatar?: string;
  title?: string;
  thumbnail_url?: string;
  scheduled_start?: string;
  actual_start?: string;
  actual_end?: string;
  status: 'live' | 'upcoming' | 'ended';
  video_url?: string;
}

export interface LiveStreamGroup {
  date: string;
  streams: LiveStream[];
}
