import React, { useRef } from 'react';
import {
  Scissors,
  Upload,
  Download,
  FileAudio,
  HelpCircle,
  Sparkles,
  Layers,
  FileText,
  Waves,
  Music2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { AudioMetadata } from '../types/audio';
import { formatTime } from '../utils/wavEncoder';

interface HeaderProps {
  metadata: AudioMetadata | null;
  segmentsCount: number;
  annotatedCount: number;
  onUploadFile: (file: File) => void;
  onLoadDemoTrack: () => void;
  onOpenExportModal: () => void;
  onOpenHelpModal: () => void;
  onOpenDeReverbModal: () => void;
  onOpenMusicExtractorModal: () => void;
  isLoadingAudio: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  metadata,
  segmentsCount,
  annotatedCount,
  onUploadFile,
  onLoadDemoTrack,
  onOpenExportModal,
  onOpenHelpModal,
  onOpenDeReverbModal,
  onOpenMusicExtractorModal,
  isLoadingAudio,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
    e.target.value = '';
  };

  const isAllAnnotated = segmentsCount > 0 && annotatedCount === segmentsCount;

  return (
    <header className="bg-white border-b border-neutral-200 px-4 sm:px-6 py-3 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand identity */}
        <div className="flex items-center gap-3.5">
          <div className="w-8 h-8 rounded-lg bg-black border border-neutral-800 flex items-center justify-center text-white shadow-sm">
            <Scissors className="w-4 h-4 rotate-45 text-white" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold tracking-tight text-neutral-900 font-mono">
                VOICESLICE
              </span>
              <span className="text-[11px] font-mono text-neutral-500 font-semibold tracking-wider">
                STUDIO
              </span>
              <span className="text-[11px] text-neutral-400 font-normal">/</span>
              <span className="text-[11px] text-neutral-600 font-normal">TTS Audio Prep</span>
            </div>
            {metadata ? (
              <div className="flex items-center gap-2 text-[11px] text-neutral-500 font-mono mt-0.5">
                <span className="text-neutral-900 font-medium truncate max-w-[200px]" title={metadata.name}>
                  {metadata.name}
                </span>
                <span className="text-neutral-300">·</span>
                <span>{formatTime(metadata.duration)}</span>
                <span className="text-neutral-300">·</span>
                <span>{(metadata.sampleRate / 1000).toFixed(1)} kHz</span>
                <span className="text-neutral-300">·</span>
                <span className={isAllAnnotated ? 'text-black font-semibold' : 'text-neutral-600'}>
                  {annotatedCount}/{segmentsCount} annotated
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Precision audio cutter & transcript annotator for speech training
              </p>
            )}
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* Load Sample Demo Audio */}
          <button
            onClick={onLoadDemoTrack}
            disabled={isLoadingAudio}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 transition"
            title="Generate sample speech track with sentences to test cutting"
          >
            <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
            <span className="hidden sm:inline">Load Demo Speech</span>
            <span className="sm:hidden">Demo</span>
          </button>

          {/* Upload Local Audio Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoadingAudio}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-800 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 transition shadow-sm"
          >
            <Upload className="w-3.5 h-3.5 text-neutral-600" />
            <span>Open Audio</span>
          </button>

          {/* Undo & Redo History Controls */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-neutral-300 bg-neutral-100 shadow-sm">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded-md text-neutral-700 hover:text-black hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-700 transition"
              title="Undo last action (Ctrl+Z / ⌘Z)"
              aria-label="Undo"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-3.5 bg-neutral-300" />
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded-md text-neutral-700 hover:text-black hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-700 transition"
              title="Redo action (Ctrl+Y / ⌘Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* De-Reverb Room Cleaner Button */}
          <button
            onClick={onOpenDeReverbModal}
            disabled={!metadata || isLoadingAudio}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 disabled:opacity-30 disabled:hover:bg-neutral-100 transition shadow-sm"
            title="Acoustic De-Reverb: suppress mic room reflections, echo tails, and standing boxiness"
          >
            <Waves className="w-3.5 h-3.5 text-black" />
            <span>De-Reverb</span>
          </button>

          {/* Extract Music & Vocal Isolation Button */}
          <button
            onClick={onOpenMusicExtractorModal}
            disabled={!metadata || isLoadingAudio}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 disabled:opacity-30 disabled:hover:bg-neutral-100 transition shadow-sm"
            title="Extract Music: strip background music & instrumentals to isolate clean speech (per-file and batch)"
          >
            <Music2 className="w-3.5 h-3.5 text-black" />
            <span>Extract Music</span>
          </button>

          {/* Keyboard Shortcuts Help */}
          <button
            onClick={onOpenHelpModal}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-100 border border-transparent hover:border-neutral-200 transition"
            title="Keyboard shortcuts & TTS dataset guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-neutral-200 mx-1" />

          {/* Export Dataset Button - High-Contrast Pure Monochrome */}
          <button
            onClick={onOpenExportModal}
            disabled={segmentsCount === 0 || isLoadingAudio}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm disabled:opacity-30 disabled:hover:bg-black transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Dataset</span>
            {segmentsCount > 0 && (
              <span className="font-mono text-[10px] text-neutral-300 bg-neutral-800 px-1 rounded">
                {segmentsCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
