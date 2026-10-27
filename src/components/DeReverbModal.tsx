import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  CheckSquare,
  Square,
  Search,
  Check,
  Layers,
  ArrowRight
} from 'lucide-react';
import {
  DeReverbSettings,
  DEFAULT_DEREVERB_SETTINGS,
  DEREVERB_PRESETS,
  createDeReverbPreview,
  processDeReverbBuffer,
  batchDeReverbSegments
} from '../utils/deReverb';
import { AudioSegment } from '../types/audio';
import { formatTime, encodeAudioSegmentToWav } from '../utils/wavEncoder';

interface DeReverbModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  activeSegment: AudioSegment | null;
  onApplyBatch: (cleanedBuffer: AudioBuffer, processedSegmentIds?: string[]) => void;
}

export const DeReverbModal: React.FC<DeReverbModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  segments,
  activeSegment,
  onApplyBatch,
}) => {
  const [settings, setSettings] = useState<DeReverbSettings>(DEFAULT_DEREVERB_SETTINGS);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Bedroom / Untreated Room');

  // Scope mode: 'batch' (selected clips) vs 'full' (entire audio track)
  const [targetScope, setTargetScope] = useState<'batch' | 'full'>('batch');

  // Multi-segment selection state (Set of segment IDs)
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(() => {
    // Default to active segment or all segments if none
    if (activeSegment) {
      return new Set([activeSegment.id]);
    }
    return new Set(segments.map((s) => s.id));
  });

  const [segmentSearchQuery, setSegmentSearchQuery] = useState('');

  // Currently previewed segment for A/B testing
  const [previewSegmentId, setPreviewSegmentId] = useState<string | null>(
    activeSegment ? activeSegment.id : segments[0]?.id || null
  );

  // A/B Preview state
  const [previewMode, setPreviewMode] = useState<'dry' | 'wet'>('dry');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isLoopingPreview, setIsLoopingPreview] = useState(true);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);

  // Batch execution progress
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchStatusText, setBatchStatusText] = useState('');

  // Audio preview buffers
  const originalPreviewRef = useRef<AudioBuffer | null>(null);
  const cleanedPreviewRef = useRef<AudioBuffer | null>(null);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Re-synchronize default selected segments when modal opens
  useEffect(() => {
    if (isOpen) {
      if (activeSegment) {
        setSelectedSegmentIds(new Set([activeSegment.id]));
        setPreviewSegmentId(activeSegment.id);
      } else if (segments.length > 0) {
        setSelectedSegmentIds(new Set(segments.map((s) => s.id)));
        setPreviewSegmentId(segments[0].id);
      }
    }
  }, [isOpen, activeSegment, segments]);

  // Target preview segment object
  const currentPreviewSeg = useMemo(() => {
    return segments.find((s) => s.id === previewSegmentId) || segments[0] || null;
  }, [segments, previewSegmentId]);

  const previewStart = currentPreviewSeg ? currentPreviewSeg.startTime : 0;
  const previewDuration = currentPreviewSeg
    ? Math.min(10.0, Math.max(1.5, currentPreviewSeg.endTime - currentPreviewSeg.startTime))
    : Math.min(8.0, audioBuffer ? audioBuffer.duration : 5.0);

  // Generate / update A/B preview when preview target or settings change
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
          if (isPlayingPreview) {
            startPlayback(previewMode);
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
    setIsPlayingPreview(true);
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

  // Filtered segments for selection list
  const filteredSegments = useMemo(() => {
    return segments.filter((s) => {
      const q = segmentSearchQuery.toLowerCase();
      return s.id.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
    });
  }, [segments, segmentSearchQuery]);

  // Selection toggle handlers
  const handleToggleSelectSegment = (id: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSegmentIds(new Set(segments.map((s) => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedSegmentIds(new Set());
  };

  const handleSelectWithText = () => {
    const withText = segments.filter((s) => s.text.trim().length > 0).map((s) => s.id);
    setSelectedSegmentIds(new Set(withText));
  };

  const handleSelectWithoutText = () => {
    const withoutText = segments.filter((s) => s.text.trim().length === 0).map((s) => s.id);
    setSelectedSegmentIds(new Set(withoutText));
  };

  if (!isOpen || !audioBuffer) return null;

  // Execute Batch Application
  const handleExecuteDeReverb = async () => {
    stopPreview();
    setIsProcessingBatch(true);
    setBatchProgress(0);

    try {
      if (targetScope === 'full') {
        // Full track dereverberation
        setBatchStatusText('De-reverberating full audio track (multi-band spectral subtraction)...');
        await new Promise((r) => setTimeout(r, 60));
        const cleaned = await processDeReverbBuffer(audioBuffer, settings);
        onApplyBatch(cleaned);
        onClose();
      } else {
        // Batch segments dereverberation
        const selectedSegmentsList = segments.filter((s) => selectedSegmentIds.has(s.id));
        if (selectedSegmentsList.length === 0) {
          alert('Please select at least one segment to de-reverb.');
          setIsProcessingBatch(false);
          return;
        }

        const cleanedBuffer = await batchDeReverbSegments(
          audioBuffer,
          selectedSegmentsList,
          settings,
          (progress, currentSegId, current, total) => {
            setBatchProgress(progress);
            setBatchStatusText(`Processing ${current} of ${total}: ${currentSegId}`);
          }
        );

        onApplyBatch(cleanedBuffer, Array.from(selectedSegmentIds));
        onClose();
      }
    } catch (err) {
      console.error('Failed batch de-reverberation:', err);
      alert('Error during batch de-reverberation processing.');
    } finally {
      setIsProcessingBatch(false);
      setBatchStatusText('');
    }
  };

  // Direct WAV export of cleaned audio
  const handleDownloadCleanWav = async () => {
    stopPreview();
    setIsProcessingBatch(true);
    setBatchStatusText('Encoding master clean WAV...');

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
      console.error('Failed to export cleaned WAV:', err);
    } finally {
      setIsProcessingBatch(false);
      setBatchStatusText('');
    }
  };

  const estimatedDbReduction = Math.round((settings.strength / 100) * 12.5 * 10) / 10;
  const numSelected = targetScope === 'full' ? segments.length : selectedSegmentIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center shadow-sm">
              <Waves className="w-4 h-4 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                  Batch De-Reverb & Room Acoustic Cleaner
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-800 font-semibold border border-neutral-200">
                  Batch Multi-Clip
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Suppress room reflections and echo tails across multiple selected clips or entire track
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessingBatch}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Target Scope Selection & Multi-Segment Checklist */}
          <div className="space-y-3 bg-neutral-50 p-4 rounded-xl border border-neutral-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-black" />
                <span>Target Processing Scope:</span>
              </span>

              {/* Scope Switcher Tabs */}
              <div className="flex items-center p-0.5 bg-neutral-200/80 rounded-lg border border-neutral-300">
                <button
                  onClick={() => setTargetScope('batch')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    targetScope === 'batch'
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-neutral-600 hover:text-black'
                  }`}
                >
                  Selected Clips ({selectedSegmentIds.size} of {segments.length})
                </button>
                <button
                  onClick={() => setTargetScope('full')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                    targetScope === 'full'
                      ? 'bg-black text-white font-bold shadow-sm'
                      : 'text-neutral-600 hover:text-black'
                  }`}
                >
                  Entire Audio Track ({segments.length} clips)
                </button>
              </div>
            </div>

            {/* If Batch Mode is selected, render segment checklist */}
            {targetScope === 'batch' && (
              <div className="space-y-2.5 pt-2 border-t border-neutral-200">
                {/* Search & Quick selection actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-neutral-400" />
                    <input
                      type="text"
                      value={segmentSearchQuery}
                      onChange={(e) => setSegmentSearchQuery(e.target.value)}
                      placeholder="Filter clips by ID or text..."
                      className="w-full bg-white border border-neutral-300 rounded-lg pl-8 pr-3 py-1 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-black shadow-sm"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      onClick={handleSelectAll}
                      className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-700 hover:text-black border border-neutral-300 font-medium transition shadow-sm"
                    >
                      Select All ({segments.length})
                    </button>
                    <button
                      onClick={handleDeselectAll}
                      className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-700 hover:text-black border border-neutral-300 font-medium transition shadow-sm"
                    >
                      Deselect All
                    </button>
                    <button
                      onClick={handleSelectWithText}
                      className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-700 hover:text-black border border-neutral-300 font-medium transition shadow-sm"
                    >
                      Only Annotated
                    </button>
                  </div>
                </div>

                {/* Scrollable Segment Checklist Table */}
                <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-inner max-h-48 overflow-y-auto divide-y divide-neutral-100">
                  {filteredSegments.length === 0 ? (
                    <div className="p-4 text-center text-xs text-neutral-400">
                      No segments match search query.
                    </div>
                  ) : (
                    filteredSegments.map((seg) => {
                      const isChecked = selectedSegmentIds.has(seg.id);
                      const isCurrentPreview = seg.id === previewSegmentId;
                      const segDuration = seg.endTime - seg.startTime;

                      return (
                        <div
                          key={seg.id}
                          onClick={() => handleToggleSelectSegment(seg.id)}
                          className={`px-3 py-2 flex items-center justify-between gap-3 text-xs transition cursor-pointer select-none ${
                            isChecked
                              ? 'bg-neutral-50/80 hover:bg-neutral-100'
                              : 'bg-white hover:bg-neutral-50 text-neutral-600'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Checkbox */}
                            <div className="shrink-0 text-black">
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 fill-black text-white" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-300" />
                              )}
                            </div>

                            <span className="font-mono font-semibold text-neutral-900 min-w-[70px]">
                              {seg.id}
                            </span>

                            <span className="text-[11px] font-mono text-neutral-500 min-w-[45px]">
                              {segDuration.toFixed(2)}s
                            </span>

                            <span className="text-[11px] text-neutral-400 font-mono hidden sm:inline">
                              {formatTime(seg.startTime)} → {formatTime(seg.endTime)}
                            </span>

                            <span className="text-neutral-300 mx-1 hidden sm:inline">·</span>

                            <p className="text-[11px] text-neutral-600 truncate max-w-[220px]">
                              {seg.text.trim().length > 0 ? (
                                seg.text
                              ) : (
                                <span className="italic text-neutral-400">No transcript</span>
                              )}
                            </p>
                          </div>

                          {/* Quick Audition Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewSegmentId(seg.id);
                              if (!isPlayingPreview) {
                                startPlayback(previewMode);
                              }
                            }}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 border shrink-0 ${
                              isCurrentPreview
                                ? 'bg-black text-white border-black font-semibold'
                                : 'bg-white text-neutral-700 hover:text-black border-neutral-200 hover:bg-neutral-100'
                            }`}
                            title="Audition this specific segment in the A/B preview deck"
                          >
                            <Volume2 className="w-3 h-3" />
                            <span>{isCurrentPreview ? 'Auditioning' : 'Audition'}</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono px-1">
                  <span>
                    Selected for De-Reverb:{' '}
                    <strong className="text-black font-bold">
                      {selectedSegmentIds.size} of {segments.length} clips
                    </strong>
                  </span>
                  <span>Click "Audition" on any row to test in real time</span>
                </div>
              </div>
            )}
          </div>

          {/* Real-time A/B Interactive Audio Preview Monitor */}
          <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-black" />
                <span>Audition Preview ({currentPreviewSeg?.id || 'Clip'})</span>
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
                  Previewing:{' '}
                  <span className="text-black font-semibold font-mono">
                    {currentPreviewSeg?.id} ({previewDuration.toFixed(1)}s)
                  </span>
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
                    Protects speech attacks and consonants
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

          {/* Batch Progress Bar */}
          {isProcessingBatch && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-neutral-900">{batchStatusText}</span>
                <span className="text-neutral-600 font-bold">{batchProgress}%</span>
              </div>
              <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black transition-all duration-75"
                  style={{ width: `${batchProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-neutral-50 border-t border-neutral-200 gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isProcessingBatch}
              className="px-4 py-2 text-xs font-medium text-neutral-600 hover:text-black transition"
            >
              Cancel
            </button>

            {/* Direct Master WAV Download */}
            <button
              onClick={handleDownloadCleanWav}
              disabled={isProcessingBatch}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
              title="Download clean processed master audio as WAV"
            >
              <Download className="w-3.5 h-3.5 text-neutral-600" />
              <span>Download Clean WAV</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Primary Action Button */}
            <button
              onClick={handleExecuteDeReverb}
              disabled={isProcessingBatch || (targetScope === 'batch' && selectedSegmentIds.size === 0)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm disabled:opacity-30 disabled:hover:bg-black transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isProcessingBatch
                  ? 'Processing...'
                  : targetScope === 'full'
                  ? `De-Reverb Entire Track (${segments.length} clips)`
                  : `De-Reverb ${selectedSegmentIds.size} Selected Clip${
                      selectedSegmentIds.size === 1 ? '' : 's'
                    }`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
