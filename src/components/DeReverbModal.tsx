import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Play,
  Pause,
  Repeat,
  Volume2,
  CheckCircle2,
  Sliders,
  Waves,
  Zap,
  Download,
  Info
} from 'lucide-react';
import {
  DeReverbSettings,
  DEFAULT_DEREVERB_SETTINGS,
  DEREVERB_PRESETS,
  createDeReverbPreview,
  processDeReverbBuffer
} from '../utils/deReverb';
import { AudioSegment } from '../types/audio';
import { formatTime, encodeAudioSegmentToWav } from '../utils/wavEncoder';

interface DeReverbModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer | null;
  activeSegment: AudioSegment | null;
  onApplyToEntireTrack: (cleanedBuffer: AudioBuffer) => void;
  onApplyToSegmentOnly: (segmentId: string, cleanedSegmentBuffer: AudioBuffer) => void;
}

export const DeReverbModal: React.FC<DeReverbModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  activeSegment,
  onApplyToEntireTrack,
  onApplyToSegmentOnly,
}) => {
  const [settings, setSettings] = useState<DeReverbSettings>(DEFAULT_DEREVERB_SETTINGS);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Bedroom / Untreated Room');

  // Preview state
  const [previewMode, setPreviewMode] = useState<'dry' | 'wet'>('dry');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isLoopingPreview, setIsLoopingPreview] = useState(true);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);
  const [isProcessingFull, setIsProcessingFull] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  // Audio preview buffers
  const originalPreviewRef = useRef<AudioBuffer | null>(null);
  const cleanedPreviewRef = useRef<AudioBuffer | null>(null);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewStartAudioTimeRef = useRef<number>(0);
  const previewOffsetRef = useRef<number>(0);

  // Time region to preview
  const previewStart = activeSegment ? activeSegment.startTime : 0;
  const previewDuration = activeSegment
    ? Math.min(10.0, Math.max(1.5, activeSegment.endTime - activeSegment.startTime))
    : Math.min(8.0, audioBuffer ? audioBuffer.duration : 5.0);

  // Initialize and re-generate preview when buffer or key settings change
  useEffect(() => {
    if (!isOpen || !audioBuffer) return;

    let isCancelled = false;
    const generate = async () => {
      setIsProcessingPreview(true);
      try {
        const { originalSlice, cleanedSlice } = await createDeReverbPreview(
          audioBuffer,
          previewStart,
          previewDuration,
          settings
        );
        if (!isCancelled) {
          originalPreviewRef.current = originalSlice;
          cleanedPreviewRef.current = cleanedSlice;
          // If currently playing, seamlessly switch buffer
          if (isPlayingPreview) {
            restartPlaybackWithCurrentBuffer();
          }
        }
      } catch (err) {
        console.error('Failed to create de-reverb preview:', err);
      } finally {
        if (!isCancelled) setIsProcessingPreview(false);
      }
    };

    const timer = setTimeout(generate, 120);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, audioBuffer, previewStart, previewDuration, settings]);

  // Audio preview playback functions
  const stopPreview = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch (_) {}
      activeSourceRef.current = null;
    }
    setIsPlayingPreview(false);
  };

  const startPlayback = (targetMode: 'dry' | 'wet') => {
    stopPreview();

    const targetBuffer =
      targetMode === 'dry' ? cleanedPreviewRef.current : originalPreviewRef.current;
    if (!targetBuffer) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!previewAudioCtxRef.current || previewAudioCtxRef.current.state === 'closed') {
      previewAudioCtxRef.current = new AudioCtx();
    }
    const ctx = previewAudioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = targetBuffer;
    source.loop = isLoopingPreview;

    source.connect(ctx.destination);

    source.onended = () => {
      if (!source.loop) {
        setIsPlayingPreview(false);
        activeSourceRef.current = null;
      }
    };

    source.start(0);
    activeSourceRef.current = source;
    previewStartAudioTimeRef.current = ctx.currentTime;
    setIsPlayingPreview(true);
  };

  const restartPlaybackWithCurrentBuffer = () => {
    startPlayback(previewMode);
  };

  const togglePreviewPlay = () => {
    if (isPlayingPreview) {
      stopPreview();
    } else {
      startPlayback(previewMode);
    }
  };

  const switchPreviewMode = (mode: 'dry' | 'wet') => {
    setPreviewMode(mode);
    if (isPlayingPreview) {
      startPlayback(mode);
    }
  };

  // Clean up on unmount or modal close
  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      if (previewAudioCtxRef.current) {
        previewAudioCtxRef.current.close().catch(() => {});
        previewAudioCtxRef.current = null;
      }
    }
  }, [isOpen]);

  if (!isOpen || !audioBuffer) return null;

  // Apply to Entire Master Track
  const handleApplyFullTrack = async () => {
    setIsProcessingFull(true);
    setProcessingStatus('De-reverberating master audio track...');
    stopPreview();

    try {
      // Yield to UI to show spinner
      await new Promise((r) => setTimeout(r, 60));
      const cleaned = await processDeReverbBuffer(audioBuffer, settings);
      onApplyToEntireTrack(cleaned);
      onClose();
    } catch (err) {
      console.error('Failed to de-reverb full track:', err);
      alert('Error during de-reverberation processing.');
    } finally {
      setIsProcessingFull(false);
      setProcessingStatus('');
    }
  };

  // Apply to Selected Segment Only
  const handleApplySegmentOnly = async () => {
    if (!activeSegment) return;
    setIsProcessingFull(true);
    setProcessingStatus(`De-reverberating segment ${activeSegment.id}...`);
    stopPreview();

    try {
      await new Promise((r) => setTimeout(r, 60));

      // Extract segment audio, de-reverb, and replace
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(activeSegment.startTime * sampleRate);
      const endSample = Math.floor(activeSegment.endTime * sampleRate);
      const segLength = endSample - startSample;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const segBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, segLength, sampleRate);

      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const srcData = audioBuffer.getChannelData(c).subarray(startSample, endSample);
        segBuffer.copyToChannel(srcData, c);
      }

      const cleanedSeg = await processDeReverbBuffer(segBuffer, settings);
      await ctx.close();

      onApplyToSegmentOnly(activeSegment.id, cleanedSeg);
      onClose();
    } catch (err) {
      console.error('Failed to de-reverb segment:', err);
      alert('Error during segment de-reverberation.');
    } finally {
      setIsProcessingFull(false);
      setProcessingStatus('');
    }
  };

  // Direct download of de-reverbed WAV file
  const handleDownloadCleanWav = async () => {
    setIsProcessingFull(true);
    setProcessingStatus('Encoding de-reverbed master WAV...');
    stopPreview();

    try {
      await new Promise((r) => setTimeout(r, 60));
      const cleaned = await processDeReverbBuffer(audioBuffer, settings);
      const { blob } = await encodeAudioSegmentToWav(cleaned, 0, cleaned.duration, {
        sampleRate: cleaned.sampleRate,
        channels: 1,
        normalize: true,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dereverbed_clean_${Math.round(cleaned.duration)}s.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download cleaned audio:', err);
    } finally {
      setIsProcessingFull(false);
      setProcessingStatus('');
    }
  };

  const estimatedDbReduction = Math.round((settings.strength / 100) * 12.5 * 10) / 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center shadow-sm">
              <Waves className="w-4 h-4 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                  Acoustic De-Reverb & Room Cleaner
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-700 font-semibold border border-neutral-200">
                  DSP V2
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Removes room reflections, standing waves, and echo tails from vocal recordings
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessingFull}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Real-time A/B Interactive Audio Preview Monitor */}
          <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-black" />
                <span>Instant A/B Audio Comparison</span>
                {isProcessingPreview && (
                  <span className="text-[10px] text-neutral-500 font-mono animate-pulse">
                    (recalculating...)
                  </span>
                )}
              </span>

              {/* Estimated Tail Suppression Stat */}
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-neutral-300 text-neutral-800">
                ~{estimatedDbReduction} dB room tail reduction
              </span>
            </div>

            {/* A/B Switch Buttons and Transport Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-neutral-200 shadow-sm">
              {/* Play / Pause / Loop Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePreviewPlay}
                  className="flex items-center justify-center w-9 h-9 rounded-lg bg-black hover:bg-neutral-800 text-white shadow-sm transition"
                  title="Play / Pause preview slice"
                >
                  {isPlayingPreview ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  onClick={() => setIsLoopingPreview(!isLoopingPreview)}
                  className={`p-2 rounded-lg text-xs border transition ${
                    isLoopingPreview
                      ? 'bg-neutral-100 border-neutral-400 text-black font-semibold'
                      : 'bg-white border-neutral-200 text-neutral-500 hover:text-black'
                  }`}
                  title="Toggle continuous loop"
                >
                  <Repeat className="w-4 h-4" />
                </button>

                <div className="text-xs font-mono text-neutral-500 pl-1">
                  Preview:{' '}
                  <span className="text-black font-semibold">
                    {previewDuration.toFixed(1)}s
                  </span>{' '}
                  {activeSegment ? `(${activeSegment.id})` : ''}
                </div>
              </div>

              {/* Mode Switcher: Wet vs Dry */}
              <div className="flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-300">
                <button
                  onClick={() => switchPreviewMode('wet')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    previewMode === 'wet'
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-neutral-600 hover:text-black'
                  }`}
                >
                  [A] Original (Wet Room)
                </button>
                <button
                  onClick={() => switchPreviewMode('dry')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    previewMode === 'dry'
                      ? 'bg-black text-white font-bold shadow-sm'
                      : 'text-neutral-600 hover:text-black'
                  }`}
                >
                  [B] Cleaned (Dry Studio Voice)
                </button>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 leading-normal">
              Click play and toggle between <strong>[A] Original</strong> and{' '}
              <strong>[B] Cleaned</strong> to hear the room echo disappear.
            </p>
          </div>

          {/* Acoustic Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-neutral-600" />
              <span>Acoustic Environment Presets</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DEREVERB_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setSettings(preset.settings);
                    setSelectedPresetName(preset.name);
                  }}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    selectedPresetName === preset.name
                      ? 'bg-black text-white border-black shadow-sm'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100 hover:text-black'
                  }`}
                >
                  <span className="text-xs font-bold leading-tight">{preset.name}</span>
                  <span
                    className={`text-[10px] mt-1 line-clamp-2 ${
                      selectedPresetName === preset.name ? 'text-neutral-300' : 'text-neutral-500'
                    }`}
                  >
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders & Parameters */}
          <div className="space-y-4 pt-1">
            <h3 className="text-xs font-semibold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-neutral-600" />
              <span>Spectral DSP Fine-Tuning</span>
            </h3>

            {/* Slider 1: De-Reverb Suppression Strength */}
            <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-800">
                  De-Reverb Suppression Strength:
                </span>
                <span className="font-mono font-bold text-neutral-900">{settings.strength}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={settings.strength}
                onChange={(e) => {
                  setSettings({ ...settings, strength: parseInt(e.target.value) });
                  setSelectedPresetName('Custom');
                }}
                className="w-full h-1.5 bg-neutral-200 rounded appearance-none cursor-pointer accent-black"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono pt-0.5">
                <span>Gentle (30%)</span>
                <span>Balanced (70%)</span>
                <span>Maximum Strip (100%)</span>
              </div>
            </div>

            {/* Slider 2: Room RT60 Decay Time */}
            <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-neutral-800">
                    Room Decay Tail (RT60):
                  </span>
                  <span className="text-[11px] text-neutral-500 ml-2">
                    {settings.decayTimeMs < 300
                      ? 'Small Studio'
                      : settings.decayTimeMs < 550
                      ? 'Untreated Room'
                      : 'Large Chamber / Hall'}
                  </span>
                </div>
                <span className="font-mono font-bold text-neutral-900">{settings.decayTimeMs} ms</span>
              </div>
              <input
                type="range"
                min="100"
                max="1000"
                step="25"
                value={settings.decayTimeMs}
                onChange={(e) => {
                  setSettings({ ...settings, decayTimeMs: parseInt(e.target.value) });
                  setSelectedPresetName('Custom');
                }}
                className="w-full h-1.5 bg-neutral-200 rounded appearance-none cursor-pointer accent-black"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono pt-0.5">
                <span>Short Tail (150ms)</span>
                <span>Typical Bedroom (400ms)</span>
                <span>Long Echo (900ms)</span>
              </div>
            </div>

            {/* Slider 3: Consonant / Transient Protection */}
            <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-neutral-800">
                    Consonant & Phoneme Protection:
                  </span>
                  <span className="text-[11px] text-neutral-500 ml-2">
                    Prevents muffling speech attacks
                  </span>
                </div>
                <span className="font-mono font-bold text-neutral-900">
                  {settings.transientPreservation}%
                </span>
              </div>
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={settings.transientPreservation}
                onChange={(e) => {
                  setSettings({ ...settings, transientPreservation: parseInt(e.target.value) });
                  setSelectedPresetName('Custom');
                }}
                className="w-full h-1.5 bg-neutral-200 rounded appearance-none cursor-pointer accent-black"
              />
            </div>

            {/* Checkbox options: Boxiness Notch & High-pass */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-800">
                  <input
                    type="checkbox"
                    checked={settings.roomBoxinessNotch}
                    onChange={(e) =>
                      setSettings({ ...settings, roomBoxinessNotch: e.target.checked })
                    }
                    className="w-4 h-4 rounded bg-white border-neutral-300 text-black accent-black"
                  />
                  <span>Tame Room Boxiness ({settings.boxinessFreqHz} Hz)</span>
                </label>
                {settings.roomBoxinessNotch && (
                  <div className="pt-1">
                    <input
                      type="range"
                      min="180"
                      max="380"
                      step="10"
                      value={settings.boxinessFreqHz}
                      onChange={(e) =>
                        setSettings({ ...settings, boxinessFreqHz: parseInt(e.target.value) })
                      }
                      className="w-full h-1 bg-neutral-300 rounded appearance-none cursor-pointer accent-black"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-neutral-400">
                      <span>180 Hz (Chest)</span>
                      <span>240 Hz (Boxy)</span>
                      <span>380 Hz (Nasal)</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-800">
                  <input
                    type="checkbox"
                    checked={settings.highPassDeRumble}
                    onChange={(e) =>
                      setSettings({ ...settings, highPassDeRumble: e.target.checked })
                    }
                    className="w-4 h-4 rounded bg-white border-neutral-300 text-black accent-black"
                  />
                  <div>
                    <span>Highpass De-Rumble (75 Hz)</span>
                    <p className="text-[10px] text-neutral-500 font-normal">
                      Cuts room AC, traffic, and sub-audible table thuds
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Processing Progress banner */}
          {isProcessingFull && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-neutral-300 border-t-black animate-spin shrink-0" />
              <div className="text-xs text-neutral-800 font-mono font-medium">
                {processingStatus}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-neutral-50 border-t border-neutral-200 gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isProcessingFull}
              className="px-4 py-2 text-xs font-medium text-neutral-600 hover:text-black transition"
            >
              Cancel
            </button>

            {/* Direct WAV Download */}
            <button
              onClick={handleDownloadCleanWav}
              disabled={isProcessingFull}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
              title="Download clean processed master audio as WAV"
            >
              <Download className="w-3.5 h-3.5 text-neutral-600" />
              <span>Download Clean WAV</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Apply to Current Segment Only */}
            {activeSegment && (
              <button
                onClick={handleApplySegmentOnly}
                disabled={isProcessingFull}
                className="px-3.5 py-2 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-900 font-semibold text-xs border border-neutral-300 transition shadow-sm"
                title={`Only de-reverb segment ${activeSegment.id}`}
              >
                Apply to Clip ({activeSegment.id})
              </button>
            )}

            {/* Apply to Entire Audio Track */}
            <button
              onClick={handleApplyFullTrack}
              disabled={isProcessingFull}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm transition"
              title="De-reverb the entire audio file across all segments"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Apply to Entire Track</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
