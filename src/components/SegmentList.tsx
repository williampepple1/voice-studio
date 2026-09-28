import React, { useState, useMemo } from 'react';
import {
  AudioSegment,
  ExportSettings,
  BulkRenameOptions,
} from '../types/audio';
import { BulkRenameModal } from './BulkRenameModal';
import {
  FileText,
  Upload,
  Split,
  Search,
  Tag,
  Play,
  Pause,
  Repeat,
  Scissors,
  Trash2,
  Download,
  Mic,
  CheckCircle2,
  Clock,
  ChevronRight
} from 'lucide-react';
import { formatTime, encodeAudioSegmentToWav } from '../utils/wavEncoder';

interface SegmentListProps {
  segments: AudioSegment[];
  activeSegmentId: string | null;
  isPlaying: boolean;
  isLooping: boolean;
  audioBuffer: AudioBuffer | null;
  exportSettings: ExportSettings;
  onSelectSegment: (id: string) => void;
  onPlaySegment: (id: string, loop?: boolean) => void;
  onStop: () => void;
  onUpdateSegmentText: (id: string, text: string) => void;
  onUpdateSegmentTimes: (id: string, startTime: number, endTime: number) => void;
  onDeleteSegment: (id: string) => void;
  onSplitInHalf: (id: string) => void;
  onImportScriptFile: (scriptLines: string[]) => void;
  onSplitRegularIntervals: (intervalSec: number) => void;
  onBulkRename: (options: BulkRenameOptions) => void;
}

export const SegmentList: React.FC<SegmentListProps> = ({
  segments,
  activeSegmentId,
  isPlaying,
  isLooping,
  audioBuffer,
  exportSettings,
  onSelectSegment,
  onPlaySegment,
  onStop,
  onUpdateSegmentText,
  onUpdateSegmentTimes,
  onDeleteSegment,
  onSplitInHalf,
  onImportScriptFile,
  onSplitRegularIntervals,
  onBulkRename,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unannotated' | 'completed'>('all');
  const [showBulkRenameModal, setShowBulkRenameModal] = useState(false);
  const [showIntervalModal, setShowIntervalModal] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(4.0);
  const [isDictating, setIsDictating] = useState(false);
  const [isDownloadingSingle, setIsDownloadingSingle] = useState(false);

  // Active segment object
  const activeSegment = useMemo(
    () => segments.find((s) => s.id === activeSegmentId) || segments[0] || null,
    [segments, activeSegmentId]
  );

  // Filtered segments for right sequence column
  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      const matchesSearch =
        seg.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        seg.text.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (filterMode === 'unannotated') {
        return seg.text.trim().length === 0;
      }
      if (filterMode === 'completed') {
        return seg.text.trim().length > 0;
      }
      return true;
    });
  }, [segments, searchQuery, filterMode]);

  const totalClips = segments.length;
  const annotatedClips = segments.filter((s) => s.text.trim().length > 0).length;
  const activeDuration = activeSegment ? activeSegment.endTime - activeSegment.startTime : 0;
  const wordCount = activeSegment ? activeSegment.text.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = activeSegment ? activeSegment.text.length : 0;

  // Handle Script File Upload (.txt or .csv)
  const handleScriptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length > 0) {
        onImportScriptFile(lines);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Browser speech recognition for dictation
  const handleVoiceDictation = () => {
    if (!activeSegment) return;
    const windowWithSpeech = window as unknown as {
      webkitSpeechRecognition?: any;
      SpeechRecognition?: any;
    };

    const SpeechRecognitionClass =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      alert('Speech Recognition is not supported by your current browser.');
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsDictating(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript && activeSegment) {
        const separator = activeSegment.text.trim().length > 0 ? ' ' : '';
        onUpdateSegmentText(activeSegment.id, activeSegment.text + separator + transcript);
      }
      setIsDictating(false);
    };

    recognition.onerror = () => {
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    recognition.start();
  };

  // Download single active WAV clip
  const handleDownloadActiveWav = async () => {
    if (!audioBuffer || !activeSegment) return;
    setIsDownloadingSingle(true);
    try {
      const { blob } = await encodeAudioSegmentToWav(
        audioBuffer,
        activeSegment.startTime,
        activeSegment.endTime,
        {
          sampleRate: exportSettings.sampleRate,
          channels: exportSettings.channels,
          normalize: exportSettings.normalizeAudio,
          targetPeakDb: exportSettings.targetPeakDb,
          microFade: exportSettings.applyMicroFade,
        }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeSegment.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating clip WAV:', err);
    } finally {
      setIsDownloadingSingle(false);
    }
  };

  // Download single active TXT transcript
  const handleDownloadActiveTxt = () => {
    if (!activeSegment) return;
    const blob = new Blob([activeSegment.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSegment.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
      {/* Sequence Header & Action Bar */}
      <div className="bg-neutral-50 px-5 py-3.5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-bold text-neutral-900 tracking-tight font-mono">
              DATASET SEGMENTS
            </h2>
            <span className="font-mono text-xs text-neutral-600 font-semibold">
              ({totalClips} clips)
            </span>
            <span className="text-neutral-400 font-mono text-xs">/</span>
            <span className="text-xs font-mono text-neutral-600">
              {annotatedClips} of {totalClips} annotated
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Import Script TXT file */}
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 cursor-pointer transition shadow-sm">
            <Upload className="w-3.5 h-3.5 text-neutral-500" />
            <span>Import Script (.txt)</span>
            <input
              type="file"
              accept=".txt,.csv"
              onChange={handleScriptUpload}
              className="hidden"
            />
          </label>

          {/* Bulk Rename */}
          <button
            onClick={() => setShowBulkRenameModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
            title="Batch rename segments with custom prefix and padding"
          >
            <Tag className="w-3.5 h-3.5 text-neutral-500" />
            <span>Bulk Rename</span>
          </button>

          {/* Split by interval button */}
          <button
            onClick={() => setShowIntervalModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-100 hover:text-black border border-neutral-300 transition shadow-sm"
            title="Split full audio into equal intervals"
          >
            <Split className="w-3.5 h-3.5 text-neutral-500" />
            <span>Split by Interval</span>
          </button>
        </div>
      </div>

      {/* Main Dual-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px]">
        {/* Left Column: Active Clip Inspector & Master Transcription Editor (7 cols) */}
        <div className="lg:col-span-7 p-5 border-b lg:border-b-0 lg:border-r border-neutral-200 flex flex-col justify-between space-y-5 bg-white">
          {activeSegment ? (
            <div className="space-y-5">
              {/* Active Clip Header */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-neutral-200">
                <div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-base font-bold text-neutral-900 tracking-tight">
                      {activeSegment.id}
                    </span>
                    <span className="font-mono text-xs text-neutral-700 font-semibold">
                      {activeDuration.toFixed(2)}s
                    </span>
                    <span className="text-neutral-300">·</span>
                    <span className="font-mono text-xs text-neutral-500">
                      {formatTime(activeSegment.startTime)} → {formatTime(activeSegment.endTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-neutral-600 mt-1 font-mono">
                    {activeDuration >= 1.0 && activeDuration <= 10.0 ? (
                      <span className="text-neutral-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                        <span>Optimal length for speech synthesis training (1–10s)</span>
                      </span>
                    ) : activeDuration < 1.0 ? (
                      <span className="text-neutral-500 flex items-center gap-1">
                        <span>Notice: Short clip (&lt;1.0s) · verify phoneme context</span>
                      </span>
                    ) : (
                      <span className="text-neutral-500 flex items-center gap-1">
                        <span>Notice: Long clip (&gt;10s) · consider splitting at pause</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary Card Transport Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (isPlaying && !isLooping) onStop();
                      else onPlaySegment(activeSegment.id, false);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                      isPlaying && !isLooping && activeSegment.id === activeSegmentId
                        ? 'bg-black text-white border-black'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-800 hover:text-black hover:bg-neutral-200'
                    }`}
                  >
                    {isPlaying && !isLooping && activeSegment.id === activeSegmentId ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>Play</span>
                  </button>

                  <button
                    onClick={() => {
                      if (isPlaying && isLooping) onStop();
                      else onPlaySegment(activeSegment.id, true);
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition border ${
                      isPlaying && isLooping && activeSegment.id === activeSegmentId
                        ? 'bg-black text-white border-black font-bold'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-800 hover:text-black hover:bg-neutral-200'
                    }`}
                    title="Seamless loop playback while typing transcript (L key)"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    <span>{isPlaying && isLooping ? 'Looping...' : 'Loop [L]'}</span>
                  </button>
                </div>
              </div>

              {/* Timing Micro-Nudge Deck */}
              <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                {/* Start time */}
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 font-mono text-[11px]">Start:</span>
                  <button
                    onClick={() =>
                      onUpdateSegmentTimes(
                        activeSegment.id,
                        Math.max(0, activeSegment.startTime - 0.05),
                        activeSegment.endTime
                      )
                    }
                    className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-800 hover:text-black font-mono text-[11px] border border-neutral-300 shadow-sm"
                    title="Trim start back 50ms"
                  >
                    -50ms
                  </button>
                  <span className="font-mono text-neutral-900 font-bold min-w-[70px] text-center">
                    {formatTime(activeSegment.startTime)}
                  </span>
                  <button
                    onClick={() =>
                      onUpdateSegmentTimes(
                        activeSegment.id,
                        Math.min(activeSegment.endTime - 0.1, activeSegment.startTime + 0.05),
                        activeSegment.endTime
                      )
                    }
                    className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-800 hover:text-black font-mono text-[11px] border border-neutral-300 shadow-sm"
                    title="Trim start forward 50ms"
                  >
                    +50ms
                  </button>
                </div>

                {/* End time */}
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 font-mono text-[11px]">End:</span>
                  <button
                    onClick={() =>
                      onUpdateSegmentTimes(
                        activeSegment.id,
                        activeSegment.startTime,
                        Math.max(activeSegment.startTime + 0.1, activeSegment.endTime - 0.05)
                      )
                    }
                    className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-800 hover:text-black font-mono text-[11px] border border-neutral-300 shadow-sm"
                    title="Trim end back 50ms"
                  >
                    -50ms
                  </button>
                  <span className="font-mono text-neutral-900 font-bold min-w-[70px] text-center">
                    {formatTime(activeSegment.endTime)}
                  </span>
                  <button
                    onClick={() =>
                      onUpdateSegmentTimes(
                        activeSegment.id,
                        activeSegment.startTime,
                        activeSegment.endTime + 0.05
                      )
                    }
                    className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-800 hover:text-black font-mono text-[11px] border border-neutral-300 shadow-sm"
                    title="Trim end forward 50ms"
                  >
                    +50ms
                  </button>
                </div>
              </div>

              {/* Master Transcription Editor Area */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-neutral-800 font-medium flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-neutral-600" />
                    <span>Exact Spoken Transcript:</span>
                  </label>
                  <div className="flex items-center gap-3 text-neutral-500 font-mono text-[11px]">
                    <span>{wordCount} words</span>
                    <span>·</span>
                    <span>{charCount} chars</span>
                    <button
                      onClick={handleVoiceDictation}
                      disabled={isDictating}
                      className="text-neutral-600 hover:text-black transition flex items-center gap-1 ml-1"
                      title="Microphone speech dictation"
                    >
                      <Mic className={`w-3.5 h-3.5 ${isDictating ? 'text-black animate-pulse' : ''}`} />
                      <span>{isDictating ? 'Listening...' : 'Dictate'}</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={activeSegment.text}
                  onChange={(e) => onUpdateSegmentText(activeSegment.id, e.target.value)}
                  placeholder="Type the exact transcript spoken in this audio slice..."
                  className="w-full bg-white border border-neutral-300 focus:border-black focus:ring-1 focus:ring-black rounded-xl p-3.5 text-sm text-neutral-900 placeholder-neutral-400 transition resize-y font-sans leading-relaxed shadow-sm"
                />

                <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-700 font-semibold">{activeSegment.id}.wav</span>
                    <span>⇄</span>
                    <span className="text-neutral-700 font-semibold">{activeSegment.id}.txt</span>
                  </div>
                  <span className="text-neutral-400">Auto-saved to dataset</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-neutral-400">
              Select or create a segment to begin typing transcript.
            </div>
          )}

          {/* Active Clip Bottom Actions */}
          {activeSegment && (
            <div className="pt-4 border-t border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSplitInHalf(activeSegment.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-neutral-700 bg-neutral-100 hover:bg-neutral-200 hover:text-black border border-neutral-300 transition"
                  title="Cut this segment exactly in half"
                >
                  <Scissors className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Split in Half</span>
                </button>

                <button
                  onClick={() => onDeleteSegment(activeSegment.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-neutral-600 hover:text-black hover:bg-neutral-100 border border-neutral-200 transition"
                  title="Delete this segment and merge time with neighbor"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadActiveWav}
                  disabled={isDownloadingSingle}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-neutral-700 hover:text-black bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 transition shadow-sm"
                  title="Download .wav file for this clip"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.WAV</span>
                </button>

                <button
                  onClick={handleDownloadActiveTxt}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-neutral-700 hover:text-black bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 transition shadow-sm"
                  title="Download .txt transcript for this clip"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.TXT</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: High-Density Clip Sequence Table (5 cols) */}
        <div className="lg:col-span-5 p-4 flex flex-col justify-between space-y-3 bg-neutral-50">
          {/* Search & Filter Tabs */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clips or text..."
                className="w-full bg-white border border-neutral-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-black shadow-sm"
              />
            </div>

            {/* Filter segmented buttons */}
            <div className="flex items-center p-0.5 bg-neutral-200/80 rounded-lg border border-neutral-300">
              <button
                onClick={() => setFilterMode('all')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition ${
                  filterMode === 'all'
                    ? 'bg-white text-neutral-900 font-semibold shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                All ({totalClips})
              </button>
              <button
                onClick={() => setFilterMode('unannotated')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition ${
                  filterMode === 'unannotated'
                    ? 'bg-white text-neutral-900 font-semibold shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Needs Text ({totalClips - annotatedClips})
              </button>
              <button
                onClick={() => setFilterMode('completed')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition ${
                  filterMode === 'completed'
                    ? 'bg-white text-neutral-900 font-semibold shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Ready ({annotatedClips})
              </button>
            </div>
          </div>

          {/* Chronological Clip List */}
          <div className="flex-1 space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
            {filteredSegments.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">
                No clips match filter.
              </div>
            ) : (
              filteredSegments.map((seg) => {
                const isSelected = seg.id === activeSegment?.id;
                const segDuration = seg.endTime - seg.startTime;
                const hasText = seg.text.trim().length > 0;

                return (
                  <div
                    key={seg.id}
                    onClick={() => onSelectSegment(seg.id)}
                    className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-white border-black ring-1 ring-black shadow-sm'
                        : 'bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-100/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Play button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPlaying && seg.id === activeSegmentId && !isLooping) {
                            onStop();
                          } else {
                            onSelectSegment(seg.id);
                            onPlaySegment(seg.id, false);
                          }
                        }}
                        className="p-1 rounded text-neutral-500 hover:text-black transition shrink-0"
                        title="Play clip"
                      >
                        {isPlaying && seg.id === activeSegmentId && !isLooping ? (
                          <Pause className="w-3.5 h-3.5 fill-current text-black" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className={`font-mono text-xs font-semibold ${isSelected ? 'text-black' : 'text-neutral-800'}`}>
                            {seg.id}
                          </span>
                          <span className="text-[11px] font-mono text-neutral-500">
                            {segDuration.toFixed(2)}s
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-600 truncate max-w-[200px] mt-0.5">
                          {hasText ? seg.text : <span className="italic text-neutral-400">No transcript</span>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {hasText ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" title="Needs text" />
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bulk Interval Modal */}
      {showIntervalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              <Split className="w-4 h-4 text-black" />
              <span>Split by Regular Interval</span>
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Splits the entire audio file into uniform duration slices. Existing cuts will be replaced.
            </p>

            <div className="space-y-2">
              <label className="text-xs text-neutral-700">Target Interval Length:</label>
              <div className="flex items-center gap-2">
                {[2.5, 3.5, 5.0, 7.0].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIntervalSeconds(s)}
                    className={`px-2.5 py-1 text-xs rounded border transition ${
                      intervalSeconds === s
                        ? 'bg-black border-black text-white font-semibold'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-700 hover:text-black hover:bg-neutral-200'
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0.5"
                max="60"
                step="0.5"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(parseFloat(e.target.value) || 4.0)}
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 font-mono mt-1"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => setShowIntervalModal(false)}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:text-black"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onSplitRegularIntervals(intervalSeconds);
                  setShowIntervalModal(false);
                }}
                className="px-4 py-1.5 bg-black hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition"
              >
                Apply Splits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Rename Modal */}
      <BulkRenameModal
        isOpen={showBulkRenameModal}
        onClose={() => setShowBulkRenameModal(false)}
        segments={segments}
        onApplyBulkRename={onBulkRename}
      />
    </div>
  );
};
