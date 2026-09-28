import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  Repeat,
  Square,
  Download,
  Trash2,
  Scissors,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Volume2,
  Mic,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles
} from 'lucide-react';
import { AudioSegment, ExportSettings } from '../types/audio';
import { formatTime, encodeAudioSegmentToWav } from '../utils/wavEncoder';

interface SegmentCardProps {
  segment: AudioSegment;
  index: number;
  isSelected: boolean;
  isPlaying: boolean;
  isLooping: boolean;
  audioBuffer: AudioBuffer | null;
  exportSettings: ExportSettings;
  onSelect: () => void;
  onPlaySegment: (loop?: boolean) => void;
  onStop: () => void;
  onUpdateText: (text: string) => void;
  onUpdateTimes: (startTime: number, endTime: number) => void;
  onDelete: () => void;
  onSplitInHalf: () => void;
}

export const SegmentCard: React.FC<SegmentCardProps> = ({
  segment,
  index,
  isSelected,
  isPlaying,
  isLooping,
  audioBuffer,
  exportSettings,
  onSelect,
  onPlaySegment,
  onStop,
  onUpdateText,
  onUpdateTimes,
  onDelete,
  onSplitInHalf,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const duration = Math.max(0, segment.endTime - segment.startTime);

  // Quality check for TTS models (Piper, VITS, FastSpeech, Tacotron)
  const isTooShort = duration < 0.8;
  const isTooLong = duration > 12.0;
  const isOptimal = !isTooShort && !isTooLong;

  // Single clip download
  const handleDownloadWav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioBuffer) return;
    setIsDownloading(true);
    try {
      const { blob } = await encodeAudioSegmentToWav(
        audioBuffer,
        segment.startTime,
        segment.endTime,
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
      a.download = `${segment.id}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading WAV:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Single txt download
  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = new Blob([segment.text.trim()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${segment.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Browser-native speech recognition helper
  const handleVoiceDictation = (e: React.MouseEvent) => {
    e.stopPropagation();
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition: any; webkitSpeechRecognition: any }).SpeechRecognition ||
      (window as unknown as { SpeechRecognition: any; webkitSpeechRecognition: any }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Web Speech API is not supported in this browser. Please type the transcript manually.");
      return;
    }

    setIsTranscribing(true);
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          onUpdateText((segment.text ? segment.text + ' ' : '') + transcript);
        }
        setIsTranscribing(false);
      };

      recognition.onerror = () => {
        setIsTranscribing(false);
      };

      recognition.onend = () => {
        setIsTranscribing(false);
      };

      recognition.start();
    } catch {
      setIsTranscribing(false);
    }
  };

  const wordCount = segment.text.trim() ? segment.text.trim().split(/\s+/).length : 0;
  const charCount = segment.text.length;

  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border transition-all duration-200 overflow-hidden flex flex-col ${
        isSelected
          ? 'bg-slate-900 border-indigo-500/80 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50'
          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700/80 hover:bg-slate-900'
      }`}
    >
      {/* Top Header of Card */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/70 border-b border-slate-800/80 gap-2">
        {/* Clip ID and TTS Length Badge */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-950/80 border border-indigo-800/60 px-2 py-0.5 rounded">
            {segment.id}
          </span>
          <span className="text-xs font-mono text-slate-300 font-medium">
            {duration.toFixed(2)}s
          </span>

          {/* Quality Indicator for TTS */}
          {isOptimal && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.5 rounded"
              title="Optimal duration (1-10s) for FastSpeech/Piper/VITS acoustic training"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>TTS Optimal</span>
            </span>
          )}
          {isTooShort && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/60 border border-amber-900/60 px-1.5 py-0.5 rounded"
              title="Very short clip (<0.8s) - make sure full syllables are included"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Short (&lt;0.8s)</span>
            </span>
          )}
          {isTooLong && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] text-orange-400 bg-orange-950/60 border border-orange-900/60 px-1.5 py-0.5 rounded"
              title="Long clip (>12s) - consider splitting at a comma or pause"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Long (&gt;12s)</span>
            </span>
          )}
        </div>

        {/* Card Transport Buttons */}
        <div className="flex items-center gap-1.5">
          {/* Play once */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isPlaying && !isLooping) {
                onStop();
              } else {
                onPlaySegment(false);
              }
            }}
            className={`p-1.5 rounded-lg text-xs font-medium transition ${
              isPlaying && !isLooping
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
            title="Play segment once"
          >
            {isPlaying && !isLooping ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>

          {/* Loop this segment (Primary user feature!) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isPlaying && isLooping) {
                onStop();
              } else {
                onPlaySegment(true);
              }
            }}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition ${
              isPlaying && isLooping
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-900/40'
            }`}
            title="Loop this segment continuously to transcribe with ease (Shortcut: L key)"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span className="text-[11px]">{isPlaying && isLooping ? 'Looping...' : 'Loop'}</span>
          </button>

          {/* Split segment in half */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSplitInHalf();
            }}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
            title="Split this segment exactly in half"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>

          {/* Single WAV download */}
          <button
            onClick={handleDownloadWav}
            disabled={isDownloading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-indigo-300 transition"
            title={`Download ${segment.id}.wav`}
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Delete segment */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-slate-400 hover:text-rose-400 transition"
            title="Delete this segment (merges time with neighbor)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content: Timing Controls + Text Transcript */}
      <div className="p-3.5 space-y-3">
        {/* Fine-Tuning Timing Controls with Nudge Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
          {/* Start Time with Nudge */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-mono text-[11px]">Start:</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateTimes(Math.max(0, segment.startTime - 0.05), segment.endTime);
              }}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px]"
              title="Nudge start back 50ms (-0.05s)"
            >
              -0.05
            </button>
            <span className="font-mono text-indigo-300 font-medium min-w-[70px] text-center">
              {formatTime(segment.startTime)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateTimes(Math.min(segment.endTime - 0.1, segment.startTime + 0.05), segment.endTime);
              }}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px]"
              title="Nudge start forward 50ms (+0.05s)"
            >
              +0.05
            </button>
          </div>

          {/* End Time with Nudge */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-mono text-[11px]">End:</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateTimes(segment.startTime, Math.max(segment.startTime + 0.1, segment.endTime - 0.05));
              }}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px]"
              title="Nudge end back 50ms (-0.05s)"
            >
              -0.05
            </button>
            <span className="font-mono text-indigo-300 font-medium min-w-[70px] text-center">
              {formatTime(segment.endTime)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateTimes(segment.startTime, segment.endTime + 0.05);
              }}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px]"
              title="Nudge end forward 50ms (+0.05s)"
            >
              +0.05
            </button>
          </div>
        </div>

        {/* Text Transcript Area (User's primary requirement: "attach the actual text to them") */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="text-slate-400 font-medium flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>Corresponding Transcript:</span>
            </label>

            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
              <span>{wordCount} words</span>
              <span>•</span>
              <span>{charCount} chars</span>
              {/* Optional Web Speech dictation trigger */}
              <button
                onClick={handleVoiceDictation}
                disabled={isTranscribing}
                className="flex items-center gap-1 text-slate-400 hover:text-indigo-300 transition"
                title="Dictate text with microphone"
              >
                <Mic className={`w-3 h-3 ${isTranscribing ? 'text-rose-400 animate-pulse' : ''}`} />
                <span className="text-[10px]">{isTranscribing ? 'Listening...' : 'Dictate'}</span>
              </button>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            rows={2}
            value={segment.text}
            onChange={(e) => onUpdateText(e.target.value)}
            onFocus={onSelect}
            placeholder="Type the exact spoken words for this audio cut (e.g. 'Welcome to the training recording.')..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg p-2.5 text-sm text-slate-100 placeholder-slate-600 transition resize-y font-sans leading-relaxed"
          />

          {/* File pair preview indicator */}
          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="text-indigo-400">{segment.id}.wav</span>
              <span className="text-slate-600">⇄</span>
              <span className="text-amber-400">{segment.id}.txt</span>
            </div>

            <button
              onClick={handleDownloadTxt}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
              title="Download only this transcript text file"
            >
              <span>Download .txt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
