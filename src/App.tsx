import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { WaveformEditor } from './components/WaveformEditor';
import { PlaybackBar } from './components/PlaybackBar';
import { SegmentList } from './components/SegmentList';
import { ExportModal } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { DeReverbModal } from './components/DeReverbModal';
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

  // UI state
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);
  const [isDeReverbModalOpen, setIsDeReverbModalOpen] = useState<boolean>(false);

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
    } catch (err) {
      console.error('Failed to decode audio:', err);
      alert('Could not decode this audio file. Please ensure it is a valid audio format.');
    } finally {
      setIsLoadingAudio(false);
      setLoadingMessage('');
    }
  };

  // Generate and load demo speech track
  const handleLoadDemoTrack = async () => {
    setIsLoadingAudio(true);
    setLoadingMessage('Synthesizing demo speech segments...');
    try {
      const ctx = globalAudioEngine.getContext();
      const { buffer, suggestedCuts } = await generateDemoAudioBuffer(ctx, (msg) => {
        setLoadingMessage(msg);
      });

      setAudioBuffer(buffer);
      globalAudioEngine.setBuffer(buffer);

      const meta: AudioMetadata = {
        name: 'demo_tts_training_sample.wav',
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
    (splitTime: number) => {
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

        setActiveSegmentId(segA.id);
        return reindexed;
      });
    },
    [audioBuffer]
  );

  // Delete split boundary between segment i and i+1 (merging them)
  const handleDeleteSplit = useCallback((index: number) => {
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
  }, []);

  // Split specific segment in half
  const handleSplitInHalf = (id: string) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const mid = seg.startTime + (seg.endTime - seg.startTime) / 2;
    handleAddSplit(mid);
  };

  // Update segment text transcript
  const handleUpdateSegmentText = (id: string, text: string) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, text } : s))
    );
  };

  // Update segment boundary times
  const handleUpdateSegmentTimes = (
    id: string,
    startTime: number,
    endTime: number
  ) => {
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
    setSegments((prev) => {
      if (prev.length <= 1) {
        alert("Cannot delete the only segment. At least one segment must remain.");
        return prev;
      }
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

    setSegments(newSegments);
    setActiveSegmentId(newSegments[0]?.id || null);
  };

  // Import TXT script lines (pasting line by line into segments)
  const handleImportScriptFile = (lines: string[]) => {
    setSegments((prev) => {
      return prev.map((seg, idx) => ({
        ...seg,
        text: lines[idx] !== undefined ? lines[idx] : seg.text,
      }));
    });
  };

  // Bulk rename all segments with prefix, padding, and start number
  const handleBulkRename = (options: BulkRenameOptions) => {
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

  // De-Reverb: Apply to entire master audio buffer
  const handleApplyDeReverbToEntireTrack = (cleanedBuffer: AudioBuffer) => {
    setAudioBuffer(cleanedBuffer);
    globalAudioEngine.setBuffer(cleanedBuffer);
  };

  // De-Reverb: Apply to selected segment only
  const handleApplyDeReverbToSegmentOnly = (segmentId: string, cleanedSegmentBuffer: AudioBuffer) => {
    if (!audioBuffer) return;
    const targetSegment = segments.find((s) => s.id === segmentId);
    if (!targetSegment) return;

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(targetSegment.startTime * sampleRate);
    const segSamples = cleanedSegmentBuffer.length;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const newBuffer = ctx.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      sampleRate
    );

    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const originalData = audioBuffer.getChannelData(c);
      const cleanSegData = cleanedSegmentBuffer.getChannelData(
        Math.min(c, cleanedSegmentBuffer.numberOfChannels - 1)
      );

      const newChannelData = new Float32Array(originalData);
      for (let i = 0; i < segSamples; i++) {
        if (startSample + i < newChannelData.length) {
          newChannelData[startSample + i] = cleanSegData[i];
        }
      }
      newBuffer.getChannelData(c).set(newChannelData);
    }
    ctx.close().catch(() => {});

    setAudioBuffer(newBuffer);
    globalAudioEngine.setBuffer(newBuffer);
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
        isLoadingAudio={isLoadingAudio}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {!audioBuffer ? (
          /* Empty / Upload State */
          <AudioDropzone
            onFileSelected={handleLoadAudioFile}
            onLoadDemoTrack={handleLoadDemoTrack}
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
            />

            {/* Sticky Audio Transport & Segment Loop Controls */}
            <PlaybackBar
              isPlaying={isPlaying}
              isLooping={isLooping}
              currentTime={currentTime}
              totalDuration={audioBuffer.duration}
              playbackRate={playbackRate}
              volume={volume}
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
              canPrevSegment={canPrev}
              canNextSegment={canNext}
            />

            {/* Segment Cards List & Transcription Editor */}
            <SegmentList
              segments={segments}
              activeSegmentId={activeSegmentId}
              isPlaying={isPlaying}
              isLooping={isLooping}
              audioBuffer={audioBuffer}
              exportSettings={exportSettings}
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
        activeSegment={segments.find((s) => s.id === activeSegmentId) || null}
        onApplyToEntireTrack={handleApplyDeReverbToEntireTrack}
        onApplyToSegmentOnly={handleApplyDeReverbToSegmentOnly}
      />
    </div>
  );
}
