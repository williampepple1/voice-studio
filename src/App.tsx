import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { WaveformEditor } from './components/WaveformEditor';
import { PlaybackBar } from './components/PlaybackBar';
import { SegmentList } from './components/SegmentList';
import { ExportModal } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { DeReverbModal } from './components/DeReverbModal';
import { MusicExtractorModal } from './components/MusicExtractorModal';
import { AudioDropzone } from './components/AudioDropzone';
import { AudioSegment, ExportSettings, AudioMetadata, BulkRenameOptions } from './types/audio';
import { globalAudioEngine } from './utils/audioEngine';
import { generateDemoAudioBuffer } from './utils/audioSynthesizer';
import { detectSpeechSegments, findNearestZeroCrossing } from './utils/silenceDetector';
import { Volume2, Sparkles, AlertCircle } from 'lucide-react';

export default function App() {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  // Playback state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(1.0);
  const [autoGain, setAutoGain] = useState<boolean>(true);

  // UI state
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);
  const [isDeReverbModalOpen, setIsDeReverbModalOpen] = useState<boolean>(false);
  const [isMusicExtractorModalOpen, setIsMusicExtractorModalOpen] = useState<boolean>(false);

  // Undo / Redo History Stack for tracking changes to segments
  interface HistorySnapshot {
    segments: AudioSegment[];
    activeSegmentId: string | null;
    description: string;
  }
  const MAX_HISTORY_STEPS = 60;
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  // Keep references to latest state to avoid stale closure snapshots
  const segmentsRef = useRef<AudioSegment[]>(segments);
  segmentsRef.current = segments;
  const activeSegmentIdRef = useRef<string | null>(activeSegmentId);
  activeSegmentIdRef.current = activeSegmentId;

  // Debounce refs for boundary dragging and transcription typing
  const isAdjustingBoundaryRef = useRef(false);
  const boundaryDebounceTimerRef = useRef<number | null>(null);
  const isEditingTextRef = useRef(false);
  const textDebounceTimerRef = useRef<number | null>(null);

  // Record an undo snapshot before an action takes place
  const recordHistory = useCallback((description = 'Modify segments') => {
    setPast((prev) => [
      ...prev.slice(-MAX_HISTORY_STEPS),
      {
        segments: segmentsRef.current,
        activeSegmentId: activeSegmentIdRef.current,
        description,
      },
    ]);
    setFuture([]); // clear redo on new action
  }, []);

  // Undo action
  const handleUndo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      const newPast = prevPast.slice(0, prevPast.length - 1);

      setFuture((prevFuture) => [
        ...prevFuture,
        {
          segments: segmentsRef.current,
          activeSegmentId: activeSegmentIdRef.current,
          description: previous.description,
        },
      ]);

      setSegments(previous.segments);
      if (
        previous.activeSegmentId &&
        previous.segments.some((s) => s.id === previous.activeSegmentId)
      ) {
        setActiveSegmentId(previous.activeSegmentId);
      } else if (previous.segments.length > 0) {
        setActiveSegmentId(previous.segments[0].id);
      }
      return newPast;
    });
  }, []);

  // Redo action
  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[prevFuture.length - 1];
      const newFuture = prevFuture.slice(0, prevFuture.length - 1);

      setPast((prevPast) => [
        ...prevPast,
        {
          segments: segmentsRef.current,
          activeSegmentId: activeSegmentIdRef.current,
          description: next.description,
        },
      ]);

      setSegments(next.segments);
      if (
        next.activeSegmentId &&
        next.segments.some((s) => s.id === next.activeSegmentId)
      ) {
        setActiveSegmentId(next.activeSegmentId);
      } else if (next.segments.length > 0) {
        setActiveSegmentId(next.segments[0].id);
      }
      return newFuture;
    });
  }, []);

  // Sync auto-gain settings and segment boundaries with audio engine
  useEffect(() => {
    globalAudioEngine.setAutoGain(autoGain);
  }, [autoGain]);

  useEffect(() => {
    globalAudioEngine.setSegments(segments);
  }, [segments]);

  // Export settings (defaults tuned for standard TTS training pipelines like Piper / VITS)
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    sampleRate: 22050,
    channels: 1, // mono
    normalizeAudio: true,
    targetPeakDb: -1.0,
    applyMicroFade: true,
    trimSilencePadMs: 25,
    includeCsv: true,
    includeJson: true,
    filenamePrefix: 'clip_',
  });

  // Subscribe to audio engine time and status updates
  useEffect(() => {
    const unsubscribe = globalAudioEngine.subscribe((time, playing) => {
      setCurrentTime(time);
      setIsPlaying(playing);
      setIsLooping(globalAudioEngine.isCurrentlyLooping());
    });
    return () => unsubscribe();
  }, []);

  // Update active segment based on current playhead time if playing
  useEffect(() => {
    if (isPlaying && segments.length > 0) {
      const match = segments.find(
        (s) => currentTime >= s.startTime && currentTime <= s.endTime
      );
      if (match && match.id !== activeSegmentId && !isLooping) {
        setActiveSegmentId(match.id);
      }
    }
  }, [currentTime, isPlaying, isLooping, segments, activeSegmentId]);

  // Decode audio file into AudioBuffer
  const handleLoadAudioFile = async (file: File) => {
    setIsLoadingAudio(true);
    setLoadingMessage(`Decoding ${file.name}...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = globalAudioEngine.getContext();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      setAudioBuffer(decodedBuffer);
      globalAudioEngine.setBuffer(decodedBuffer);

      const meta: AudioMetadata = {
        name: file.name,
        duration: decodedBuffer.duration,
        sampleRate: decodedBuffer.sampleRate,
        numberOfChannels: decodedBuffer.numberOfChannels,
        fileSizeBytes: file.size,
      };
      setMetadata(meta);

      // Auto-detect initial segments via silence, or fallback to full single segment
      setLoadingMessage('Detecting speech boundaries & zero-crossings...');
      const speechCuts = detectSpeechSegments(decodedBuffer, {
        silenceThresholdDb: -35,
        minSilenceDurationSec: 0.35,
        minSpeechDurationSec: 0.8,
      });

      let initialSegments: AudioSegment[] = [];

      if (speechCuts.length > 1) {
        // Use detected speech pauses
        initialSegments = speechCuts.map((cut, idx) => ({
          id: `clip_${String(idx + 1).padStart(3, '0')}`,
          startTime: cut.startTime,
          endTime: cut.endTime,
          text: '',
        }));
      } else {
        // Single continuous clip spanning entire file
        initialSegments = [
          {
            id: 'clip_001',
            startTime: 0,
            endTime: decodedBuffer.duration,
            text: '',
          },
        ];
      }

      setSegments(initialSegments);
      setActiveSegmentId(initialSegments[0]?.id || null);
      setPast([]);
      setFuture([]);
    } catch (err) {
      console.error('Failed to decode audio:', err);
      alert('Could not decode this audio file. Please ensure it is a valid audio format.');
    } finally {
      setIsLoadingAudio(false);
      setLoadingMessage('');
    }
  };

  // Generate and load demo speech track (clean or with music bed)
  const handleLoadDemoTrack = async (withMusic = false) => {
    setIsLoadingAudio(true);
    setLoadingMessage(withMusic ? 'Synthesizing demo speech with background music bed...' : 'Synthesizing demo speech segments...');
    try {
      const ctx = globalAudioEngine.getContext();
      const { buffer, suggestedCuts } = await generateDemoAudioBuffer(
        ctx,
        (msg) => {
          setLoadingMessage(msg);
        },
        withMusic
      );

      setAudioBuffer(buffer);
      globalAudioEngine.setBuffer(buffer);

      const meta: AudioMetadata = {
        name: withMusic ? 'demo_speech_with_music.wav' : 'demo_tts_training_sample.wav',
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        fileSizeBytes: buffer.length * 2,
      };
      setMetadata(meta);

      const demoSegments: AudioSegment[] = suggestedCuts.map((cut, idx) => ({
        id: `clip_${String(idx + 1).padStart(3, '0')}`,
        startTime: cut.start,
        endTime: cut.end,
        text: cut.text,
      }));

      setSegments(demoSegments);
      setActiveSegmentId(demoSegments[0]?.id || null);
      setPast([]);
      setFuture([]);
    } catch (err) {
      console.error('Error generating demo track:', err);
      alert('Could not generate demo track.');
    } finally {
      setIsLoadingAudio(false);
      setLoadingMessage('');
    }
  };

  // Add a split marker at a specific time
  const handleAddSplit = useCallback(
    (splitTime: number, selectSecondClip = false) => {
      if (!audioBuffer) return;
      const duration = audioBuffer.duration;
      const t = Math.max(0.05, Math.min(duration - 0.05, splitTime));

      setSegments((prev) => {
        // Find segment containing t
        const targetIndex = prev.findIndex(
          (s) => t > s.startTime + 0.05 && t < s.endTime - 0.05
        );
        if (targetIndex === -1) {
          // If t is right on existing boundary, ignore
          return prev;
        }

        const target = prev[targetIndex];
        recordHistory(`Split ${target.id}`);

        const segA: AudioSegment = {
          ...target,
          endTime: Number(t.toFixed(3)),
        };
        const segB: AudioSegment = {
          id: `clip_${String(prev.length + 1).padStart(3, '0')}`,
          startTime: Number(t.toFixed(3)),
          endTime: target.endTime,
          text: '',
        };

        const updated = [...prev];
        updated.splice(targetIndex, 1, segA, segB);

        // Re-index IDs cleanly: clip_001, clip_002, etc.
        const reindexed = updated.map((s, idx) => ({
          ...s,
          id: `clip_${String(idx + 1).padStart(3, '0')}`,
        }));

        const chosenSegment = selectSecondClip
          ? reindexed[targetIndex + 1]
          : reindexed[targetIndex];

        if (chosenSegment) {
          setActiveSegmentId(chosenSegment.id);
          globalAudioEngine.seekTo(chosenSegment.startTime);
        }
        return reindexed;
      });
    },
    [audioBuffer, recordHistory]
  );

  // Delete split boundary between segment i and i+1 (merging them)
  const handleDeleteSplit = useCallback((index: number) => {
    recordHistory('Merge clips');
    setSegments((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const segA = prev[index];
      const segB = prev[index + 1];

      const mergedText = [segA.text.trim(), segB.text.trim()]
        .filter(Boolean)
        .join(' ');

      const merged: AudioSegment = {
        id: segA.id,
        startTime: segA.startTime,
        endTime: segB.endTime,
        text: mergedText,
      };

      const updated = [...prev];
      updated.splice(index, 2, merged);

      // Re-index
      return updated.map((s, idx) => ({
        ...s,
        id: `clip_${String(idx + 1).padStart(3, '0')}`,
      }));
    });
  }, [recordHistory]);

  // Split specific segment in half
  const handleSplitInHalf = (id: string) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const mid = seg.startTime + (seg.endTime - seg.startTime) / 2;
    handleAddSplit(mid);
  };

  // Update segment text transcript with typing debounce for undo grouping
  const handleUpdateSegmentText = (id: string, text: string) => {
    if (!isEditingTextRef.current) {
      recordHistory('Edit transcript');
      isEditingTextRef.current = true;
    }
    if (textDebounceTimerRef.current) {
      clearTimeout(textDebounceTimerRef.current);
    }
    textDebounceTimerRef.current = window.setTimeout(() => {
      isEditingTextRef.current = false;
    }, 1000);

    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, text } : s))
    );
  };

  // Update segment boundary times with debounce for smooth drag undo grouping
  const handleUpdateSegmentTimes = (
    id: string,
    startTime: number,
    endTime: number
  ) => {
    if (!isAdjustingBoundaryRef.current) {
      recordHistory('Adjust clip boundary');
      isAdjustingBoundaryRef.current = true;
    }
    if (boundaryDebounceTimerRef.current) {
      clearTimeout(boundaryDebounceTimerRef.current);
    }
    boundaryDebounceTimerRef.current = window.setTimeout(() => {
      isAdjustingBoundaryRef.current = false;
    }, 400);

    setSegments((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              startTime: Number(startTime.toFixed(3)),
              endTime: Number(endTime.toFixed(3)),
            }
          : s
      )
    );
  };

  // Delete individual segment (removes and expands neighbors)
  const handleDeleteSegment = (id: string) => {
    if (segments.length <= 1) {
      alert("Cannot delete the only segment. At least one segment must remain.");
      return;
    }
    recordHistory(`Delete clip ${id}`);
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;

      const updated = [...prev];
      if (idx > 0) {
        // Expand previous segment's end time
        updated[idx - 1] = {
          ...updated[idx - 1],
          endTime: updated[idx].endTime,
        };
      } else if (idx < updated.length - 1) {
        // Expand next segment's start time
        updated[idx + 1] = {
          ...updated[idx + 1],
          startTime: updated[idx].startTime,
        };
      }

      updated.splice(idx, 1);

      return updated.map((s, i) => ({
        ...s,
        id: `clip_${String(i + 1).padStart(3, '0')}`,
      }));
    });
  };

  // Run auto silence detection
  const handleAutoDetectSilence = () => {
    if (!audioBuffer) return;
    const cuts = detectSpeechSegments(audioBuffer, {
      silenceThresholdDb: -35,
      minSilenceDurationSec: 0.35,
      minSpeechDurationSec: 0.8,
    });

    if (cuts.length === 0) {
      alert("No distinct silence intervals detected with current threshold.");
      return;
    }

    if (
      segments.length > 1 &&
      !confirm(
        `Auto-detect found ${cuts.length} spoken segments. Replace current cuts?`
      )
    ) {
      return;
    }

    recordHistory('Auto-detect silence splits');

    const newSegments: AudioSegment[] = cuts.map((cut, idx) => ({
      id: `clip_${String(idx + 1).padStart(3, '0')}`,
      startTime: cut.startTime,
      endTime: cut.endTime,
      text: segments[idx]?.text || '',
    }));

    setSegments(newSegments);
    setActiveSegmentId(newSegments[0]?.id || null);
  };

  // Split audio by regular interval (e.g. every 4 seconds)
  const handleSplitRegularIntervals = (intervalSec: number) => {
    if (!audioBuffer) return;
    const dur = audioBuffer.duration;
    const newSegments: AudioSegment[] = [];

    let current = 0;
    let idx = 1;
    while (current < dur) {
      const end = Math.min(dur, current + intervalSec);
      newSegments.push({
        id: `clip_${String(idx).padStart(3, '0')}`,
        startTime: Number(current.toFixed(3)),
        endTime: Number(end.toFixed(3)),
        text: '',
      });
      current = end;
      idx++;
    }

    recordHistory('Split by regular interval');
    setSegments(newSegments);
    setActiveSegmentId(newSegments[0]?.id || null);
  };

  // Import TXT script lines (pasting line by line into segments)
  const handleImportScriptFile = (lines: string[]) => {
    recordHistory('Import script transcript');
    setSegments((prev) => {
      return prev.map((seg, idx) => ({
        ...seg,
        text: lines[idx] !== undefined ? lines[idx] : seg.text,
      }));
    });
  };

  // Bulk rename all segments with prefix, padding, and start number
  const handleBulkRename = (options: BulkRenameOptions) => {
    recordHistory('Bulk rename clips');
    setSegments((prev) => {
      const activeIdx = prev.findIndex((s) => s.id === activeSegmentId);
      const renamed = prev.map((seg, idx) => {
        const num = options.startNumber + idx;
        const numStr = String(num).padStart(options.padDigits, '0');
        const newId = `${options.prefix}${numStr}${options.suffix}`;
        return {
          ...seg,
          id: newId,
        };
      });

      // Update activeSegmentId to match renamed ID
      if (activeIdx !== -1 && renamed[activeIdx]) {
        setActiveSegmentId(renamed[activeIdx].id);
      }

      return renamed;
    });
  };

  // Playback control handlers
  const handlePlayPause = () => {
    if (!audioBuffer) return;
    if (isPlaying) {
      globalAudioEngine.pause();
    } else {
      globalAudioEngine.play();
    }
  };

  const handleStop = () => {
    globalAudioEngine.stop();
  };

  const activeSegment = segments.find((s) => s.id === activeSegmentId) || null;

  const handlePlayActiveSegment = (loop = false) => {
    if (!activeSegment || !audioBuffer) return;
    globalAudioEngine.playSegment(activeSegment.startTime, activeSegment.endTime, loop);
  };

  const handleToggleLoop = () => {
    if (!activeSegment || !audioBuffer) return;
    if (isPlaying && isLooping) {
      globalAudioEngine.stop();
    } else {
      globalAudioEngine.playSegment(activeSegment.startTime, activeSegment.endTime, true);
    }
  };

  const handleSeek = (timeSec: number) => {
    globalAudioEngine.seekTo(timeSec);
  };

  const handleChangePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    globalAudioEngine.setPlaybackRate(rate);
  };

  const handleChangeVolume = (vol: number) => {
    setVolume(vol);
    globalAudioEngine.setVolume(vol);
  };

  // Prev / Next segment navigation
  const activeIndex = segments.findIndex((s) => s.id === activeSegmentId);
  const canPrev = activeIndex > 0;
  const canNext = activeIndex !== -1 && activeIndex < segments.length - 1;

  const handlePrevSegment = () => {
    if (canPrev) {
      const prevSeg = segments[activeIndex - 1];
      setActiveSegmentId(prevSeg.id);
      globalAudioEngine.seekTo(prevSeg.startTime);
      if (isLooping) {
        globalAudioEngine.playSegment(prevSeg.startTime, prevSeg.endTime, true);
      }
    }
  };

  const handleNextSegment = () => {
    if (canNext) {
      const nextSeg = segments[activeIndex + 1];
      setActiveSegmentId(nextSeg.id);
      globalAudioEngine.seekTo(nextSeg.startTime);
      if (isLooping) {
        globalAudioEngine.playSegment(nextSeg.startTime, nextSeg.endTime, true);
      }
    }
  };

  // Keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts if user is typing in textarea or input
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Undo: Ctrl+Z / Cmd+Z (without Shift)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isTyping) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y / Cmd+Y
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
      ) {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (e.key === ' ' && !isTyping) {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key.toLowerCase() === 'l' && !isTyping) {
        e.preventDefault();
        handleToggleLoop();
      } else if (e.key.toLowerCase() === 's' && !isTyping) {
        e.preventDefault();
        handleAddSplit(currentTime);
      } else if (e.key === 'Escape') {
        handleStop();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault();
        handlePrevSegment();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault();
        handleNextSegment();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // De-Reverb: Apply cleaned audio buffer to state (single, batch, or full-track)
  const handleApplyDeReverbBatch = (cleanedBuffer: AudioBuffer, _processedSegmentIds?: string[]) => {
    setAudioBuffer(cleanedBuffer);
    globalAudioEngine.setBuffer(cleanedBuffer);
  };

  // Music Extraction: Apply vocal isolated audio buffer to state (per-clip, batch, or full-track)
  const handleApplyMusicExtractionBatch = (cleanedBuffer: AudioBuffer, processedSegmentIds?: string[]) => {
    recordHistory(
      processedSegmentIds && processedSegmentIds.length > 0
        ? `Extract music from ${processedSegmentIds.length} clips`
        : 'Extract music from entire track'
    );
    setAudioBuffer(cleanedBuffer);
    globalAudioEngine.setBuffer(cleanedBuffer);
  };

  const annotatedCount = segments.filter((s) => s.text.trim().length > 0).length;

  return (
    <div className="min-h-screen bg-white text-neutral-900 flex flex-col font-sans selection:bg-black selection:text-white">
      {/* Top Header */}
      <Header
        metadata={metadata}
        segmentsCount={segments.length}
        annotatedCount={annotatedCount}
        onUploadFile={handleLoadAudioFile}
        onLoadDemoTrack={handleLoadDemoTrack}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenHelpModal={() => setIsHelpModalOpen(true)}
        onOpenDeReverbModal={() => setIsDeReverbModalOpen(true)}
        onOpenMusicExtractorModal={() => setIsMusicExtractorModalOpen(true)}
        isLoadingAudio={isLoadingAudio}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {!audioBuffer ? (
          /* Empty / Upload State */
          <AudioDropzone
            onFileSelected={handleLoadAudioFile}
            onLoadDemoTrack={() => handleLoadDemoTrack(false)}
            onLoadDemoWithMusic={() => handleLoadDemoTrack(true)}
            isLoading={isLoadingAudio}
            loadingMessage={loadingMessage}
          />
        ) : (
          /* Active Editing Workspace */
          <div className="space-y-5">
            {/* Waveform Canvas & Cutting Timeline */}
            <WaveformEditor
              audioBuffer={audioBuffer}
              currentTime={currentTime}
              segments={segments}
              activeSegmentId={activeSegmentId}
              onSeek={handleSeek}
              onAddSplit={handleAddSplit}
              onUpdateSegmentTimes={handleUpdateSegmentTimes}
              onSelectSegment={(id) => {
                setActiveSegmentId(id);
                const seg = segments.find((s) => s.id === id);
                if (seg) {
                  globalAudioEngine.seekTo(seg.startTime);
                }
              }}
              onDeleteSplit={handleDeleteSplit}
              onAutoDetectSilence={handleAutoDetectSilence}
              onOpenDeReverb={() => setIsDeReverbModalOpen(true)}
              onOpenMusicExtractor={() => setIsMusicExtractorModalOpen(true)}
            />

            {/* Sticky Audio Transport & Segment Loop Controls */}
            <PlaybackBar
              isPlaying={isPlaying}
              isLooping={isLooping}
              currentTime={currentTime}
              totalDuration={audioBuffer.duration}
              playbackRate={playbackRate}
              volume={volume}
              autoGain={autoGain}
              activeSegment={activeSegment}
              hasAudio={!!audioBuffer}
              onPlayPause={handlePlayPause}
              onStop={handleStop}
              onToggleLoop={handleToggleLoop}
              onPlayActiveSegment={() => handlePlayActiveSegment(false)}
              onPrevSegment={handlePrevSegment}
              onNextSegment={handleNextSegment}
              onChangePlaybackRate={handleChangePlaybackRate}
              onChangeVolume={handleChangeVolume}
              onToggleAutoGain={() => setAutoGain((p) => !p)}
              canPrevSegment={canPrev}
              canNextSegment={canNext}
            />

            {/* Segment Cards List & Transcription Editor */}
            <SegmentList
              segments={segments}
              activeSegmentId={activeSegmentId}
              isPlaying={isPlaying}
              isLooping={isLooping}
              currentTime={currentTime}
              audioBuffer={audioBuffer}
              exportSettings={exportSettings}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onOpenMusicExtractor={() => setIsMusicExtractorModalOpen(true)}
              onSeek={handleSeek}
              onAddSplit={handleAddSplit}
              onSelectSegment={(id) => {
                setActiveSegmentId(id);
                const seg = segments.find((s) => s.id === id);
                if (seg) {
                  globalAudioEngine.seekTo(seg.startTime);
                }
              }}
              onPlaySegment={(id, loop) => {
                setActiveSegmentId(id);
                const seg = segments.find((s) => s.id === id);
                if (seg) {
                  globalAudioEngine.playSegment(seg.startTime, seg.endTime, loop);
                }
              }}
              onStop={handleStop}
              onUpdateSegmentText={handleUpdateSegmentText}
              onUpdateSegmentTimes={handleUpdateSegmentTimes}
              onDeleteSegment={handleDeleteSegment}
              onSplitInHalf={handleSplitInHalf}
              onImportScriptFile={handleImportScriptFile}
              onSplitRegularIntervals={handleSplitRegularIntervals}
              onBulkRename={handleBulkRename}
            />
          </div>
        )}
      </main>

      {/* Dataset Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        segments={segments}
        audioBuffer={audioBuffer}
        exportSettings={exportSettings}
        onUpdateExportSettings={(newSettings) =>
          setExportSettings((prev) => ({ ...prev, ...newSettings }))
        }
        projectName={metadata ? metadata.name.replace(/\.[^/.]+$/, '') : 'tts_dataset'}
      />

      {/* Shortcuts & Guide Modal */}
      <HelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />

      {/* Acoustic De-Reverb & Room Cleaner Modal */}
      <DeReverbModal
        isOpen={isDeReverbModalOpen}
        onClose={() => setIsDeReverbModalOpen(false)}
        audioBuffer={audioBuffer}
        segments={segments}
        activeSegment={segments.find((s) => s.id === activeSegmentId) || null}
        onApplyBatch={handleApplyDeReverbBatch}
      />

      {/* Music Extraction & Vocal Isolator Modal (Per-File & Batch) */}
      <MusicExtractorModal
        isOpen={isMusicExtractorModalOpen}
        onClose={() => setIsMusicExtractorModalOpen(false)}
        audioBuffer={audioBuffer}
        segments={segments}
        activeSegment={segments.find((s) => s.id === activeSegmentId) || null}
        onApplyBatch={handleApplyMusicExtractionBatch}
        onLoadFileToWorkspace={handleLoadAudioFile}
      />
    </div>
  );
}
