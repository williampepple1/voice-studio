import React, { useState, useRef } from 'react';
import { UploadCloud, Sparkles, FileAudio, Check, Music2 } from 'lucide-react';

interface AudioDropzoneProps {
  onFileSelected: (file: File) => void;
  onLoadDemoTrack: () => void;
  onLoadDemoWithMusic?: () => void;
  isLoading: boolean;
  loadingMessage?: string;
}

export const AudioDropzone: React.FC<AudioDropzoneProps> = ({
  onFileSelected,
  onLoadDemoTrack,
  onLoadDemoWithMusic,
  isLoading,
  loadingMessage,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelected(files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelected(e.target.files[0]);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-2xl p-10 md:p-16 text-center transition-all flex flex-col items-center justify-center min-h-[460px] shadow-sm ${
        isDragOver
          ? 'border-black bg-neutral-100'
          : 'border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac"
        onChange={handleInputChange}
        className="hidden"
      />

      {isLoading ? (
        <div className="space-y-4 flex flex-col items-center">
          <div className="w-10 h-10 rounded-full border-2 border-neutral-300 border-t-black animate-spin" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-neutral-900 font-mono">
              {loadingMessage || 'Decoding audio waveform...'}
            </h3>
            <p className="text-xs text-neutral-500">
              Analyzing zero-crossings and computing spectrogram
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-lg space-y-6 flex flex-col items-center">
          {/* Main Visual Indicator */}
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-800 shadow-sm">
            <FileAudio className="w-7 h-7 text-neutral-800" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-neutral-900 tracking-tight">
              Import Audio for TTS Dataset Curation
            </h2>
            <p className="text-xs text-neutral-600 leading-relaxed max-w-md mx-auto">
              Drag and drop any speech recording or podcast file. Slice on interactive waveforms, loop audio clips to transcribe, and export paired WAV + TXT training datasets.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center pt-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm active:scale-95 transition flex items-center justify-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Select Audio File</span>
            </button>

            <button
              onClick={onLoadDemoTrack}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 font-medium text-xs transition flex items-center justify-center gap-2 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
              <span>Demo Speech</span>
            </button>

            {onLoadDemoWithMusic && (
              <button
                onClick={onLoadDemoWithMusic}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 font-medium text-xs transition flex items-center justify-center gap-2 shadow-sm"
                title="Load speech with background music track to test music extraction"
              >
                <Music2 className="w-3.5 h-3.5 text-black" />
                <span>Demo with Music Bed</span>
              </button>
            )}
          </div>

          {/* Technical Specs */}
          <div className="pt-6 border-t border-neutral-200 w-full text-xs text-neutral-500 space-y-2.5">
            <div className="flex items-center justify-center gap-3 font-mono text-[11px] text-neutral-600">
              <span>WAV</span>
              <span>·</span>
              <span>MP3</span>
              <span>·</span>
              <span>FLAC</span>
              <span>·</span>
              <span>OGG</span>
              <span>·</span>
              <span>M4A</span>
            </div>
            <div className="flex items-center justify-center gap-4 text-neutral-700 text-xs">
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-black" /> Waveform & Spectrogram
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-black" /> Segment Looping
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-black" /> Individual WAV + TXT Pairs
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
