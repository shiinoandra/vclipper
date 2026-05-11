export interface Clip {
  id: number;
  youtube_url: string;
  title?: string;
  start_time: number;
  end_time: number;
  quality: string;
  video_codec?: string;
  audio_bitrate?: string;
  download_thumbnail: boolean;
  download_cc: boolean;
  output_dir: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  output_path?: string;
  error_message?: string;
  video_resolution?: string;
  audio_codec?: string;
  has_cc?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ClipSegment {
  id: string;
  start: number;
  end: number;
  color: string;
  quality: string;
  audioBitrate: string;
  downloadCC: boolean;
}

export interface Settings {
  default_quality?: string;
  default_video_codec?: string;
  default_audio_bitrate?: string;
  download_thumbnail?: string;
  default_output_dir?: string;
  transcription_provider_url?: string;
  transcription_api_key?: string;
  transcription_model?: string;
  transcription_language?: string;
  [key: string]: string | undefined;
}

export interface TrackedChannel {
  id: number;
  channel_id: string;
  channel_name?: string;
  avatar_url?: string;
  tags?: string;
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

export interface StreamSummary {
  id?: number;
  video_id: string;
  summary_text?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StreamMoment {
  id: number;
  video_id: string;
  start_time: number;
  end_time: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
}
