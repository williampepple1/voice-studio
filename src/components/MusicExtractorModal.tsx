import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Music2,
  X,
  Play,
  Pause,
  Repeat,
  Volume2,
  CheckCircle2,
  Sliders,
  Sparkles,
  Download,
  CheckSquare,
  Square,
  Search,
  Layers,
  UploadCloud,
  FileAudio,
  Trash2,
  FolderArchive,
  ArrowRight,
  Disc,
  Radio,
  FileCheck
} from 'lucide-react';
import {
  MusicExtractorSettings,
  DEFAULT_MUSIC_SETTINGS,
  MUSIC_EXTRACTION_PRESETS,
  createMusicExtractionPreview,
  extractMusicFromAudioBuffer,
  batchExtractMusicSegments
} from '../utils/musicExtractor';
import { AudioSegment } from '../types/audio';
import { formatTime, encodeAudioSegmentToWav } from '../utils/wavEncoder';

interface MusicExtractorModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  activeSegment: AudioSegment | null;
  onApplyBatch: (cleanedBuffer: AudioBuffer, processedSegmentIds?: string[]) => void;
  onLoadFileToWorkspace?: (file: File) => void;
}

interface BatchFileItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  cleanedBlob?: Blob;
  duration?: number;
  errorMsg?: string;
}

export const MusicExtractorModal: React.FC<MusicExtractorModalProps> = ({
  isOpen,
  onClose,
  audioBuffer,
  segments,
  activeSegment,
  onApplyBatch,
  onLoadFileToWorkspace,
}) => {
  // Main Tab Navigation: 'project' (current file/clips) vs 'batch-files' (multi-file processor)
  const [activeTab, setActiveTab] = useState<'project' | 'batch-files'>('project');

  // DSP settings and preset state
  const [settings, setSettings] = useState<MusicExtractorSettings>(DEFAULT_MUSIC_SETTINGS);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Podcast Background Music');

  // Project scope: 'batch' (selected clips) vs 'full' (entire audio file)
  const [targetScope, setTargetScope] = useState<'batch' | 'full'>('batch');

  // Multi-segment selection state
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(() => {
    if (activeSegment) {
      return new Set([activeSegment.id]);
    }
    return new Set(segments.map((s) => s.id));
  });

  const [segmentSearchQuery, setSegmentSearchQuery] = useState('');

  // Audition preview target
  const [previewSegmentId, setPreviewSegmentId] = useState<string | null>(
    activeSegment ? activeSegment.id : segments[0]?.id || null
  );

  // 3-way Audition Mode:
  // 'wet' = original mix (voice + music)
  // 'dry' = isolated vocal (music removed)
  // 'music' = extracted background music only
  const [previewMode, setPreviewMode] = useState<'wet' | 'dry' | 'music'>('dry');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isLoopingPreview, setIsLoopingPreview] = useState(true);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);

  // Execution state for project audio
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchStatusText, setBatchStatusText] = useState('');

  // Audio preview buffer refs
  const originalPreviewRef = useRef<AudioBuffer | null>(null);
  const vocalPreviewRef = useRef<AudioBuffer | null>(null);
  const musicPreviewRef = useRef<AudioBuffer | null>(null);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // External Batch Files State
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isProcessingFileBatch, setIsProcessingFileBatch] = useState(false);
  const [fileBatchProgress, setFileBatchProgress] = useState(0);
  const [fileBatchStatus, setFileBatchStatus] = useState('');
  const fileBatchInputRef = useRef<HTMLInputElement>(null);

  // Synchronize initial segment selection when opening
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

  // Target preview segment
  const currentPreviewSeg = useMemo(() => {
    return segments.find((s) => s.id === previewSegmentId) || segments[0] || null;
  }, [segments, previewSegmentId]);

  const previewStart = currentPreviewSeg ? currentPreviewSeg.startTime : 0;
  const previewDuration = currentPreviewSeg
    ? Math.min(12.0, Math.max(1.5, currentPreviewSeg.endTime - currentPreviewSeg.startTime))
    : Math.min(8.0, audioBuffer ? audioBuffer.duration : 5.0);

  // Re-generate A/B/C preview when settings or target segment change
  useEffect(() => {
    if (!isOpen || !audioBuffer || activeTab !== 'project') return;

    let isCancelled = false;
    const generate = async () => {
      setIsProcessingPreview(true);
      try {
        const { originalSlice, vocalSlice, musicSlice } = await createMusicExtractionPreview(
          audioBuffer,
          previewStart,
          previewDuration,
          settings
        );
        if (!isCancelled) {
          originalPreviewRef.current = originalSlice;
          vocalPreviewRef.current = vocalSlice;
          musicPreviewRef.current = musicSlice;
          if (isPlayingPreview) {
            startPlayback(previewMode);
          }
        }
      } catch (err) {
        console.error('Failed to create music extraction preview:', err);
      } finally {
        if (!isCancelled) setIsProcessingPreview(false);
      }
    };

    const timer = setTimeout(generate, 120);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, audioBuffer, previewStart, previewDuration, settings, activeTab]);

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

  const startPlayback = (targetMode: 'wet' | 'dry' | 'music') => {
    stopPreview();

    let targetBuffer: AudioBuffer | null = null;
    if (targetMode === 'dry') {
      targetBuffer = vocalPreviewRef.current;
    } else if (targetMode === 'music') {
      targetBuffer = musicPreviewRef.current;
    } else {
      targetBuffer = originalPreviewRef.current;
    }

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

  const switchPreviewMode = (mode: 'wet' | 'dry' | 'music') => {
    setPreviewMode(mode);
    if (isPlayingPreview) {
      startPlayback(mode);
    }
  };

  // Cleanup on close or unmount
  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      if (previewAudioCtxRef.current) {
        previewAudioCtxRef.current.close().catch(() => {});
        previewAudioCtxRef.current = null;
      }
    }
  }, [isOpen]);

  // Filtered segments for selection
  const filteredSegments = useMemo(() => {
    return segments.filter((s) => {
      const q = segmentSearchQuery.toLowerCase();
      return s.id.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
    });
  }, [segments, segmentSearchQuery]);

  // Toggle selection
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

  // Execute extraction on project audio
  const handleExecuteProjectExtraction = async () => {
    if (!audioBuffer) return;
    stopPreview();
    setIsProcessingBatch(true);
    setBatchProgress(0);

    try {
      if (targetScope === 'full') {
        // Full file music extraction
        setBatchStatusText('Extracting music from entire audio file (STFT spectral vocal isolation)...');
        await new Promise((r) => setTimeout(r, 60));
        const { vocalBuffer } = await extractMusicFromAudioBuffer(audioBuffer, settings);
        onApplyBatch(vocalBuffer);
        onClose();
      } else {
        // Batch segments music extraction
        const selectedSegmentsList = segments.filter((s) => selectedSegmentIds.has(s.id));
        if (selectedSegmentsList.length === 0) {
          alert('Please select at least one segment to process.');
          setIsProcessingBatch(false);
          return;
        }

        const cleanedBuffer = await batchExtractMusicSegments(
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
      console.error('Failed music extraction:', err);
      alert('Error during music extraction processing.');
    } finally {
      setIsProcessingBatch(false);
      setBatchStatusText('');
    }
  };

  // Download isolated vocal WAV or music WAV of entire file
  const handleDownloadTrackStem = async (stemType: 'vocal' | 'music') => {
    if (!audioBuffer) return;
    stopPreview();
    setIsProcessingBatch(true);
    setBatchStatusText(`Encoding ${stemType === 'vocal' ? 'isolated vocal' : 'extracted music'} stem...`);

    try {
      await new Promise((r) => setTimeout(r, 60));
      const { vocalBuffer, musicBuffer } = await extractMusicFromAudioBuffer(audioBuffer, settings);
      const targetBuffer = stemType === 'vocal' ? vocalBuffer : musicBuffer;

      const { blob } = await encodeAudioSegmentToWav(targetBuffer, 0, targetBuffer.duration, {
        sampleRate: targetBuffer.sampleRate,
        channels: targetBuffer.numberOfChannels === 2 ? 2 : 1,
        normalize: true,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stemType === 'vocal' ? 'isolated_voice' : 'extracted_music'}_${Math.round(
        targetBuffer.duration
      )}s.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export stem:', err);
    } finally {
      setIsProcessingBatch(false);
      setBatchStatusText('');
    }
  };

  // --------------------------------------------------------------------------
  // External Batch File Processor Handlers
  // --------------------------------------------------------------------------
  const handleAddBatchFiles = (newFiles: FileList | File[]) => {
    const validFiles: BatchFileItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const f = newFiles[i];
      if (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(f.name)) {
        validFiles.push({
          id: `${f.name}_${Date.now()}_${i}`,
          file: f,
          status: 'pending',
          progress: 0,
        });
      }
    }
    setBatchFiles((prev) => [...prev, ...validFiles]);
  };

  const handleRemoveBatchFile = (id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleClearBatchFiles = () => {
    setBatchFiles([]);
  };

  // Process all files in the batch queue
  const handleProcessAllBatchFiles = async () => {
    if (batchFiles.length === 0 || isProcessingFileBatch) return;

    setIsProcessingFileBatch(true);
    setFileBatchProgress(0);

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();

    try {
      for (let i = 0; i < batchFiles.length; i++) {
        const item = batchFiles[i];
        if (item.status === 'done' && item.cleanedBlob) continue;

        setBatchFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: 'processing', progress: 10 } : f))
        );
        setFileBatchStatus(`Decoding file ${i + 1} of ${batchFiles.length}: ${item.file.name}`);

        try {
          const arrayBuf = await item.file.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuf);

          setFileBatchStatus(`Extracting music from: ${item.file.name}...`);
          setBatchFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, progress: 40 } : f))
          );

          // Extract vocal stem
          const { vocalBuffer } = await extractMusicFromAudioBuffer(decoded, settings);

          setBatchFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, progress: 80 } : f))
          );

          // Encode clean WAV
          const { blob, duration } = await encodeAudioSegmentToWav(
            vocalBuffer,
            0,
            vocalBuffer.duration,
            {
              sampleRate: vocalBuffer.sampleRate,
              channels: 1, // mono clean speech for TTS
              normalize: true,
              microFade: true,
            }
          );

          setBatchFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: 'done',
                    progress: 100,
                    cleanedBlob: blob,
                    duration,
                  }
                : f
            )
          );
        } catch (err: any) {
          console.error(`Error processing ${item.file.name}:`, err);
          setBatchFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: 'error',
                    progress: 0,
                    errorMsg: err?.message || 'Processing failed',
                  }
                : f
            )
          );
        }

        const overallPct = Math.round(((i + 1) / batchFiles.length) * 100);
        setFileBatchProgress(overallPct);
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      setIsProcessingFileBatch(false);
      setFileBatchStatus('');
      ctx.close().catch(() => {});
    }
  };

  // Download all processed files as a ZIP archive
  const handleDownloadAllCleanZip = async () => {
    const doneFiles = batchFiles.filter((f) => f.status === 'done' && f.cleanedBlob);
    if (doneFiles.length === 0) return;

    const zip = new JSZip();
    for (const item of doneFiles) {
      const cleanName = item.file.name.replace(/\.[^/.]+$/, '') + '_voice_clean.wav';
      const arrayBuf = await item.cleanedBlob!.arrayBuffer();
      zip.file(cleanName, arrayBuf);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch_voice_cleaned_${doneFiles.length}_files.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download single processed file
  const handleDownloadSingleBatchFile = (item: BatchFileItem) => {
    if (!item.cleanedBlob) return;
    const cleanName = item.file.name.replace(/\.[^/.]+$/, '') + '_voice_clean.wav';
    const url = URL.createObjectURL(item.cleanedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load cleaned file into VoiceSlice Studio workspace
  const handleLoadCleanedToWorkspace = (item: BatchFileItem) => {
    if (!item.cleanedBlob || !onLoadFileToWorkspace) return;
    const cleanName = item.file.name.replace(/\.[^/.]+$/, '') + '_clean.wav';
    const file = new File([item.cleanedBlob], cleanName, { type: 'audio/wav' });
    onLoadFileToWorkspace(file);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center shadow-sm">
              <Music2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                  Music Extraction & Vocal Isolator
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-800 font-semibold border border-neutral-200">
                  Per-File & Batch
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Extract background music, instrumentals, and soundtrack beds to isolate clean speaking voice for TTS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessingBatch || isProcessingFileBatch}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Navigation Tabs */}
        <div className="flex items-center px-6 pt-3 border-b border-neutral-200 bg-neutral-50/60 gap-4">
          <button
            onClick={() => setActiveTab('project')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'project'
                ? 'border-black text-black'
                : 'border-transparent text-neutral-500 hover:text-black'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Current Audio & Clips {audioBuffer && `(${segments.length} clips)`}</span>
          </button>

          <button
            onClick={() => setActiveTab('batch-files')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'batch-files'
                ? 'border-black text-black'
                : 'border-transparent text-neutral-500 hover:text-black'
            }`}
          >
            <FolderArchive className="w-3.5 h-3.5" />
            <span>
              Batch Audio Files Processor {batchFiles.length > 0 && `(${batchFiles.length})`}
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {activeTab === 'project' ? (
            /* TAB 1: CURRENT PROJECT AUDIO & CLIPS */
            <>
              {/* Target Scope Switcher */}
              <div className="space-y-3 bg-neutral-50 p-4 rounded-xl border border-neutral-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-black" />
                    <span>Target Extraction Scope:</span>
                  </span>

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

                {/* Batch Segment Checklist */}
                {targetScope === 'batch' && (
                  <div className="space-y-2.5 pt-2 border-t border-neutral-200">
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

                    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-inner max-h-44 overflow-y-auto divide-y divide-neutral-100">
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
                                title="Audition this specific segment in the A/B deck"
                              >
                                <Volume2 className="w-3 h-3" />
                                <span>{isCurrentPreview ? 'Auditioning' : 'Audition'}</span>
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3-Way Audition Preview Deck */}
              <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-black" />
                    <span>Real-Time Audition Deck ({currentPreviewSeg?.id || 'Clip'})</span>
                    {isProcessingPreview && (
                      <span className="text-[10px] text-neutral-500 font-mono animate-pulse">
                        (calculating stems...)
                      </span>
                    )}
                  </span>

                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-neutral-300 text-neutral-800">
                    ~{Math.round((settings.strength / 100) * 18 * 10) / 10} dB music attenuation
                  </span>
                </div>

                {/* 3-Way Mode Switcher & Transport */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-neutral-200 shadow-sm">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePreviewPlay}
                      className="flex items-center justify-center w-9 h-9 rounded-lg bg-black hover:bg-neutral-800 text-white shadow-sm transition"
                      title="Play / Pause audition"
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
                      Auditioning:{' '}
                      <span className="text-black font-semibold font-mono">
                        {currentPreviewSeg?.id} ({previewDuration.toFixed(1)}s)
                      </span>
                    </div>
                  </div>

                  {/* 3 Buttons: Original / Isolated Voice / Extracted Music */}
                  <div className="flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-300">
                    <button
                      onClick={() => switchPreviewMode('wet')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                        previewMode === 'wet'
                          ? 'bg-white text-black font-bold shadow-sm'
                          : 'text-neutral-600 hover:text-black'
                      }`}
                    >
                      [A] Voice + Music
                    </button>
                    <button
                      onClick={() => switchPreviewMode('dry')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                        previewMode === 'dry'
                          ? 'bg-black text-white font-bold shadow-sm'
                          : 'text-neutral-600 hover:text-black'
                      }`}
                    >
                      [B] Isolated Voice
                    </button>
                    <button
                      onClick={() => switchPreviewMode('music')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                        previewMode === 'music'
                          ? 'bg-neutral-800 text-white font-bold shadow-sm'
                          : 'text-neutral-600 hover:text-black'
                      }`}
                    >
                      [C] Extracted Music
                    </button>
                  </div>
                </div>
              </div>

              {/* Extraction Presets */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Music Separation Presets</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {MUSIC_EXTRACTION_PRESETS.map((preset) => (
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

              {/* Fine-Tuning Sliders */}
              <div className="space-y-4 pt-1">
                <h3 className="text-xs font-semibold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Spectral DSP Fine-Tuning</span>
                </h3>

                {/* Slider 1: Music Extraction Strength */}
                <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-800">
                      Music Extraction Strength:
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
                    <span>Balanced (75%)</span>
                    <span>Maximum Strip (100%)</span>
                  </div>
                </div>

                {/* Slider 2: Vocal Body & Consonant Preservation */}
                <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-neutral-800">
                        Vocal Body & Consonant Preservation:
                      </span>
                      <span className="text-[11px] text-neutral-500 ml-2">
                        Preserves speech formants, syllable clarity, and speech warmth
                      </span>
                    </div>
                    <span className="font-mono font-bold text-neutral-900">
                      {settings.vocalPreservation}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    step="5"
                    value={settings.vocalPreservation}
                    onChange={(e) => {
                      setSettings({ ...settings, vocalPreservation: parseInt(e.target.value) });
                      setSelectedPresetName('Custom');
                    }}
                    className="w-full h-1.5 bg-neutral-200 rounded appearance-none cursor-pointer accent-black"
                  />
                </div>

                {/* Slider 3: Stereo Side-Channel Cancellation */}
                <div className="space-y-1 bg-white p-3 rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-neutral-800">
                        Stereo Side-Channel Cancellation:
                      </span>
                      <span className="text-[11px] text-neutral-500 ml-2">
                        Cancels panned stereo guitars, synths, and stereo reverb
                      </span>
                    </div>
                    <span className="font-mono font-bold text-neutral-900">
                      {settings.stereoCancellation}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={settings.stereoCancellation}
                    onChange={(e) => {
                      setSettings({ ...settings, stereoCancellation: parseInt(e.target.value) });
                      setSelectedPresetName('Custom');
                    }}
                    className="w-full h-1.5 bg-neutral-200 rounded appearance-none cursor-pointer accent-black"
                  />
                </div>

                {/* Filter Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-800">
                      <input
                        type="checkbox"
                        checked={settings.subBassCut}
                        onChange={(e) =>
                          setSettings({ ...settings, subBassCut: e.target.checked })
                        }
                        className="w-4 h-4 rounded bg-white border-neutral-300 text-black accent-black"
                      />
                      <div>
                        <span>Sub-Bass Beat Cut (85 Hz)</span>
                        <p className="text-[10px] text-neutral-500 font-normal">
                          Strips 808 sub-bass, kick drum thuds, and low instrument rumble
                        </p>
                      </div>
                    </label>
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-800">
                      <input
                        type="checkbox"
                        checked={settings.highFrequencyCut}
                        onChange={(e) =>
                          setSettings({ ...settings, highFrequencyCut: e.target.checked })
                        }
                        className="w-4 h-4 rounded bg-white border-neutral-300 text-black accent-black"
                      />
                      <div>
                        <span>High-Frequency Sizzle Roll-off (7.5 kHz)</span>
                        <p className="text-[10px] text-neutral-500 font-normal">
                          Removes drum cymbals, hi-hats, and synthesizer sparkle
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
            </>
          ) : (
            /* TAB 2: BATCH EXTERNAL AUDIO FILES PROCESSOR */
            <div className="space-y-4">
              <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-2">
                    <FolderArchive className="w-4 h-4 text-black" />
                    <span>Batch Multi-File Music Stripper</span>
                  </h3>
                  <span className="text-[11px] font-mono text-neutral-500">
                    {batchFiles.length} file{batchFiles.length === 1 ? '' : 's'} in queue
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  Upload multiple audio files at once to strip background music from all of them simultaneously. Download cleaned speech files individually or packaged as a ZIP archive.
                </p>
              </div>

              {/* Upload Dropzone */}
              <input
                ref={fileBatchInputRef}
                type="file"
                multiple
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleAddBatchFiles(e.target.files);
                  }
                }}
                className="hidden"
              />

              <div
                onClick={() => fileBatchInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleAddBatchFiles(e.dataTransfer.files);
                  }
                }}
                className="border-2 border-dashed border-neutral-300 hover:border-black rounded-xl p-6 text-center cursor-pointer transition bg-white hover:bg-neutral-50 group"
              >
                <div className="w-10 h-10 rounded-full bg-neutral-100 group-hover:bg-neutral-200 text-neutral-700 flex items-center justify-center mx-auto mb-2 transition">
                  <UploadCloud className="w-5 h-5 text-black" />
                </div>
                <p className="text-xs font-semibold text-neutral-900">
                  Drop multiple audio files here, or <span className="underline">browse files</span>
                </p>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Supports WAV, MP3, M4A, FLAC, OGG, AAC
                </p>
              </div>

              {/* Queue Table */}
              {batchFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-800">
                      Batch Queue ({batchFiles.length} files):
                    </span>
                    <button
                      onClick={handleClearBatchFiles}
                      disabled={isProcessingFileBatch}
                      className="text-[11px] text-neutral-500 hover:text-red-600 font-medium transition"
                    >
                      Clear List
                    </button>
                  </div>

                  <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-inner max-h-52 overflow-y-auto divide-y divide-neutral-100">
                    {batchFiles.map((item, idx) => (
                      <div
                        key={item.id}
                        className="px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <FileAudio className="w-4 h-4 text-neutral-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-neutral-900 truncate max-w-[280px]">
                              {item.file.name}
                            </p>
                            <span className="text-[10px] text-neutral-400 font-mono">
                              {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                              {item.duration ? ` · ${item.duration.toFixed(1)}s` : ''}
                            </span>
                          </div>
                        </div>

                        {/* Status / Action */}
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'pending' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-600 border border-neutral-200">
                              Pending
                            </span>
                          )}
                          {item.status === 'processing' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-200 text-neutral-800 animate-pulse font-semibold">
                              Processing {item.progress}%
                            </span>
                          )}
                          {item.status === 'done' && (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-black text-white font-semibold flex items-center gap-1">
                                <FileCheck className="w-3 h-3" />
                                Cleaned
                              </span>
                              <button
                                onClick={() => handleDownloadSingleBatchFile(item)}
                                className="p-1 rounded hover:bg-neutral-100 text-neutral-600 hover:text-black transition"
                                title="Download clean voice WAV"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              {onLoadFileToWorkspace && (
                                <button
                                  onClick={() => handleLoadCleanedToWorkspace(item)}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium transition"
                                  title="Open in VoiceSlice editor"
                                >
                                  Open
                                </button>
                              )}
                            </div>
                          )}
                          {item.status === 'error' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-100 text-red-700">
                              Error
                            </span>
                          )}

                          {!isProcessingFileBatch && (
                            <button
                              onClick={() => handleRemoveBatchFile(item.id)}
                              className="p-1 text-neutral-400 hover:text-red-500 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Batch File Processing Progress Bar */}
                  {isProcessingFileBatch && (
                    <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-neutral-900 truncate max-w-[400px]">
                          {fileBatchStatus}
                        </span>
                        <span className="text-neutral-700 font-bold">{fileBatchProgress}%</span>
                      </div>
                      <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-black transition-all duration-75"
                          style={{ width: `${fileBatchProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Batch File Queue Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      onClick={handleProcessAllBatchFiles}
                      disabled={isProcessingFileBatch || batchFiles.length === 0}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs transition shadow-sm disabled:opacity-30"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {isProcessingFileBatch
                          ? 'Extracting Music...'
                          : `Extract Music from All (${batchFiles.length} Files)`}
                      </span>
                    </button>

                    {batchFiles.some((f) => f.status === 'done') && (
                      <button
                        onClick={handleDownloadAllCleanZip}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-900 font-semibold text-xs border border-neutral-300 transition shadow-sm"
                      >
                        <FolderArchive className="w-3.5 h-3.5 text-neutral-700" />
                        <span>Download All Cleaned (ZIP)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-neutral-50 border-t border-neutral-200 gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isProcessingBatch || isProcessingFileBatch}
              className="px-4 py-2 text-xs font-medium text-neutral-600 hover:text-black transition"
            >
              Cancel
            </button>

            {/* Direct Stem Downloads for current track */}
            {activeTab === 'project' && audioBuffer && (
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={() => handleDownloadTrackStem('vocal')}
                  disabled={isProcessingBatch}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
                  title="Export isolated speech stem as WAV"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Voice Stem WAV</span>
                </button>
                <button
                  onClick={() => handleDownloadTrackStem('music')}
                  disabled={isProcessingBatch}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
                  title="Export extracted music/instrumental stem as WAV"
                >
                  <Disc className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Music Stem WAV</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'project' && (
              <button
                onClick={handleExecuteProjectExtraction}
                disabled={
                  isProcessingBatch ||
                  (targetScope === 'batch' && selectedSegmentIds.size === 0) ||
                  !audioBuffer
                }
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm disabled:opacity-30 disabled:hover:bg-black transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isProcessingBatch
                    ? 'Processing...'
                    : targetScope === 'full'
                    ? `Extract Music from Entire Track (${segments.length} clips)`
                    : `Extract Music from ${selectedSegmentIds.size} Selected Clip${
                        selectedSegmentIds.size === 1 ? '' : 's'
                      }`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
