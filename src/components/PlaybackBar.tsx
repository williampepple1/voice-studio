import React, { useEffect, useState, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Gauge,
  Activity,
  SlidersHorizontal
} from 'lucide-react';
import { formatTime } from '../utils/wavEncoder';
import { AudioSegment } from '../types/audio';
import { globalAudioEngine, AudioLevels } from '../utils/audioEngine';

interface PlaybackBarProps {
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  totalDuration: number;
  playbackRate: number;
  volume: number;
  autoGain: boolean;
  activeSegment: AudioSegment | null;
  hasAudio: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onPlayActiveSegment: () => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onChangePlaybackRate: (rate: number) => void;
  onChangeVolume: (volume: number) => void;
  onToggleAutoGain: () => void;
  canPrevSegment: boolean;
  canNextSegment: boolean;
}

export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  isPlaying,
  isLooping,
  currentTime,
  totalDuration,
  playbackRate,
  volume,
  autoGain,
  activeSegment,
  hasAudio,
  onPlayPause,
  onStop,
  onToggleLoop,
  onPlayActiveSegment,
  onPrevSegment,
  onNextSegment,
  onChangePlaybackRate,
  onChangeVolume,
  onToggleAutoGain,
  canPrevSegment,
  canNextSegment,
}) => {
  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];

  // Real-time audio levels state
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({
    rms: 0,
    rmsDb: -90,
    peak: 0,
    peakDb: -90,
    isClipping: false,
  });

  const [peakHoldDb, setPeakHoldDb] = useState<number>(-90);
  const [hasClipped, setHasClipped] = useState<boolean>(false);
  const [currentAutoGainDb, setCurrentAutoGainDb] = useState<number>(0);
  const peakHoldTimerRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Poll real-time levels via requestAnimationFrame when audio is active
  useEffect(() => {
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const levels = globalAudioEngine.getAudioLevels();
      setAudioLevels(levels);
      setCurrentAutoGainDb(globalAudioEngine.getAutoGainDb());

      // Peak hold logic with smooth release
      if (levels.peakDb > peakHoldDb) {
        setPeakHoldDb(levels.peakDb);
        peakHoldTimerRef.current = now;
      } else if (now - peakHoldTimerRef.current > 1200) {
        // Decay peak hold marker by 25 dB/sec
        setPeakHoldDb((prev) => Math.max(-90, prev - 25 * dt));
      }

      if (levels.isClipping) {
        setHasClipped(true);
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [peakHoldDb]);

  // Map decibels (-60dB to 0dB) to percentage (0% to 100%)
  const dbToPercent = (db: number) => {
    const minDb = -60;
    const maxDb = 0;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
  };

  const rmsPercent = dbToPercent(audioLevels.rmsDb);
  const peakPercent = dbToPercent(audioLevels.peakDb);
  const peakHoldPercent = dbToPercent(peakHoldDb);

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-4 text-neutral-900">
      {/* Left: Navigation and Primary Transport Controls */}
      <div className="flex items-center gap-2">
        {/* Skip to Previous Segment */}
        <button
          onClick={onPrevSegment}
          disabled={!canPrevSegment || !hasAudio}
          className="p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-100 border border-neutral-200 transition"
          title="Previous Segment (Ctrl/Cmd + [)"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        {/* Master Play / Pause */}
        <button
          onClick={onPlayPause}
          disabled={!hasAudio}
          className="flex items-center justify-center w-11 h-11 rounded-xl bg-black hover:bg-neutral-800 text-white shadow-sm active:scale-95 disabled:opacity-30 transition"
          title="Play / Pause Full Audio (Spacebar)"
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          disabled={!hasAudio}
          className="p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-100 border border-neutral-200 transition"
          title="Stop Playback (Esc)"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>

        {/* Skip to Next Segment */}
        <button
          onClick={onNextSegment}
          disabled={!canNextSegment || !hasAudio}
          className="p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-100 border border-neutral-200 transition"
          title="Next Segment (Ctrl/Cmd + ])"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <div className="h-6 w-px bg-neutral-200 mx-1" />

        {/* Play Current Segment Specifically */}
        {activeSegment && (
          <button
            onClick={onPlayActiveSegment}
            disabled={!hasAudio}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-900 text-xs font-semibold shadow-sm transition"
            title={`Play current segment (${activeSegment.id})`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Play Segment ({activeSegment.id})</span>
          </button>
        )}

        {/* Loop Active Segment Toggle */}
        <button
          onClick={onToggleLoop}
          disabled={!hasAudio || !activeSegment}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition border shadow-sm ${
            isLooping
              ? 'bg-black text-white border-black ring-2 ring-neutral-300 animate-pulse'
              : 'bg-neutral-100 border-neutral-300 text-neutral-700 hover:bg-neutral-200'
          }`}
          title="Toggle Seamless Loop Playback on Current Segment (Shortcut: L key)"
        >
          <Repeat className={`w-3.5 h-3.5 ${isLooping ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
          <span>Loop Segment</span>
          <span className="text-[10px] opacity-75 font-mono">[L]</span>
        </button>
      </div>

      {/* Center-Left: Time Readout */}
      <div className="flex items-center gap-3">
        <div className="font-mono text-xs tracking-wide bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-900">
          <span className="text-black font-bold">{formatTime(currentTime)}</span>
          <span className="text-neutral-400 mx-1.5">/</span>
          <span className="text-neutral-500">{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Center-Right: Real-Time RMS & Peak Amplitude Meter */}
      <div className="flex items-center gap-2.5 bg-neutral-50 px-3 py-1.5 rounded-xl border border-neutral-200 shadow-inner">
        <Activity className="w-3.5 h-3.5 text-neutral-600 shrink-0" />

        <div className="flex flex-col gap-1 w-32 sm:w-44">
          {/* Top: Peak Level Bar with Peak-Hold Needle */}
          <div className="relative h-2 bg-neutral-200 rounded-sm overflow-hidden border border-neutral-300">
            {/* Peak bar */}
            <div
              className="h-full transition-all duration-75 rounded-sm"
              style={{
                width: `${peakPercent}%`,
                background:
                  audioLevels.peakDb > -3
                    ? 'linear-gradient(90deg, #737373 60%, #404040 85%, #000000 100%)'
                    : '#525252',
              }}
            />
            {/* Peak Hold Marker line */}
            {peakHoldPercent > 2 && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-black shadow-sm z-10"
                style={{ left: `${Math.min(99, peakHoldPercent)}%` }}
              />
            )}
          </div>

          {/* Bottom: RMS Loudness Meter Bar */}
          <div className="relative h-1.5 bg-neutral-200 rounded-sm overflow-hidden border border-neutral-300">
            <div
              className="h-full transition-all duration-100 rounded-sm bg-neutral-800"
              style={{
                width: `${rmsPercent}%`,
              }}
            />
          </div>

          {/* Decibel scale ticks */}
          <div className="flex justify-between text-[8px] font-mono text-neutral-500 px-0.5 leading-none select-none">
            <span>-48</span>
            <span>-24</span>
            <span>-12</span>
            <span>-6</span>
            <span className="text-neutral-700">-3</span>
            <span className="text-black font-semibold">0dB</span>
          </div>
        </div>

        {/* Real-time numerical readout */}
        <div className="flex flex-col text-[9px] font-mono text-neutral-600 min-w-[58px] leading-tight">
          <div>
            <span className="text-neutral-400">RMS:</span>{' '}
            <span className={audioLevels.rmsDb > -12 ? 'text-black font-bold' : 'text-neutral-700'}>
              {audioLevels.rmsDb > -80 ? `${audioLevels.rmsDb}dB` : '-∞'}
            </span>
          </div>
          <div>
            <span className="text-neutral-400">PK:</span>{' '}
            <span className={audioLevels.peakDb > -3 ? 'text-black font-bold' : 'text-neutral-700'}>
              {audioLevels.peakDb > -80 ? `${audioLevels.peakDb}dB` : '-∞'}
            </span>
          </div>
        </div>

        {/* Clip Alert Box */}
        <button
          onClick={() => setHasClipped(false)}
          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase transition select-none ${
            hasClipped
              ? 'bg-black text-white animate-pulse shadow-md cursor-pointer'
              : 'bg-neutral-100 text-neutral-400 border border-neutral-200'
          }`}
          title={hasClipped ? 'Audio clipping detected! Click to reset' : 'No clipping'}
        >
          CLIP
        </button>
      </div>

      {/* Right: Playback Speed & Volume */}
      <div className="flex items-center gap-3">
        {/* Speed presets */}
        <div className="flex items-center gap-1 bg-neutral-50 p-1 rounded-lg border border-neutral-200">
          <Gauge className="w-3.5 h-3.5 text-neutral-400 ml-1" />
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onChangePlaybackRate(s)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition ${
                playbackRate === s
                  ? 'bg-black text-white font-bold'
                  : 'text-neutral-600 hover:text-black'
              }`}
              title={`Set playback speed to ${s}x`}
            >
              {s}x
            </button>
          ))}
          {/* Auto-Gain (Normalization) Toggle */}
          <button
            onClick={onToggleAutoGain}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition border shadow-sm ${
              autoGain
                ? 'bg-black text-white border-black'
                : 'bg-neutral-100 text-neutral-600 hover:text-black border-neutral-300 hover:bg-neutral-200'
            }`}
            title={
              autoGain
                ? 'Auto-Gain is ON: Automatically levels out loudness differences between quiet and loud clips'
                : 'Auto-Gain is OFF: Click to automatically normalize loudness across all clips during playback'
            }
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="font-semibold text-[11px] hidden sm:inline">Auto-Gain</span>
            <span
              className={`text-[9px] px-1 py-0.5 rounded font-bold leading-none ${
                autoGain ? 'bg-neutral-800 text-neutral-200' : 'bg-neutral-200 text-neutral-600'
              }`}
            >
              {autoGain ? 'ON' : 'OFF'}
            </span>
            {autoGain && isPlaying && currentAutoGainDb !== 0 && (
              <span className="text-[9px] text-neutral-400 font-mono hidden md:inline">
                {currentAutoGainDb > 0 ? `+${currentAutoGainDb}` : currentAutoGainDb}dB
              </span>
            )}
          </button>
        </div>

        {/* Volume slider */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeVolume(volume === 0 ? 1 : 0)}
            className="text-neutral-600 hover:text-black transition"
            title={volume === 0 ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? <VolumeX className="w-4 h-4 text-neutral-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
            className="w-16 sm:w-20 h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-black"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>
      </div>
    </div>
  );
};
