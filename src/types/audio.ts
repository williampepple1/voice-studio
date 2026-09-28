export interface AudioSegment {
  id: string; // e.g. "clip_001"
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string; // user-attached transcript
  speaker?: string;
  notes?: string;
  isLooping?: boolean;
}

export interface ExportSettings {
  sampleRate: 22050 | 24000 | 44100 | 48000;
  channels: 1 | 2; // 1 = mono (recommended for TTS), 2 = stereo
  normalizeAudio: boolean;
  targetPeakDb: number; // e.g. -1 dB
  applyMicroFade: boolean; // 5ms fade-in and fade-out to prevent zero-crossing clicks
  trimSilencePadMs: number; // 0 to 50ms padding
  includeCsv: boolean; // metadata.csv (LJSpeech style)
  includeJson: boolean; // manifest.json
  filenamePrefix: string; // e.g. "clip_"
  applyDeReverb?: boolean; // Apply room reflection & echo suppression
}

export interface AudioPlaybackState {
  isPlaying: boolean;
  isLoopingSegment: boolean;
  currentTime: number;
  activeSegmentId: string | null;
  playbackRate: number; // 0.5, 0.75, 1, 1.25, 1.5
  volume: number; // 0 to 1
}

export interface AudioMetadata {
  name: string;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  fileSizeBytes: number;
}

export interface BulkRenameOptions {
  prefix: string; // e.g. "speaker1_"
  suffix: string; // e.g. "_clean"
  startNumber: number; // e.g. 1
  padDigits: number; // e.g. 3 -> "001"
  pattern: string; // e.g. "{prefix}{num}{suffix}"
}

