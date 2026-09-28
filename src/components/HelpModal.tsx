import React from 'react';
import { X, Keyboard, Sparkles, BookOpen } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                Studio Guide & Keyboard Shortcuts
              </h2>
              <p className="text-[11px] text-neutral-500">
                Acoustic guidelines for Piper, VITS, and FastSpeech training
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto text-xs text-neutral-700">
          {/* Shortcuts */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-neutral-500" />
              <span>Keyboard Controls</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 bg-neutral-50 p-3 rounded-xl border border-neutral-200 font-mono text-[11px]">
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Play / Pause</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 text-neutral-900 rounded border border-neutral-300">Space</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Loop Clip</span>
                <kbd className="px-1.5 py-0.5 bg-black text-white font-bold rounded">L</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Cut at Playhead</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 text-neutral-900 rounded border border-neutral-300">S</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Stop Audio</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 text-neutral-900 rounded border border-neutral-300">Esc</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Previous Clip</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 text-neutral-900 rounded border border-neutral-300">Ctrl + [</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-white border border-neutral-200">
                <span className="text-neutral-600">Next Clip</span>
                <kbd className="px-1.5 py-0.5 bg-neutral-100 text-neutral-900 rounded border border-neutral-300">Ctrl + ]</kbd>
              </div>
            </div>
          </div>

          {/* Workflow Guide */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-neutral-500" />
              <span>TTS Acoustic Best Practices</span>
            </h3>
            <ul className="space-y-2 text-neutral-600 leading-relaxed list-disc list-inside">
              <li>
                <strong className="text-neutral-900">Segment Lengths (1–10s):</strong> Modern acoustic neural networks converge best on short natural sentences or clauses. Avoid single words (&lt;0.8s) or run-on monologues (&gt;12s).
              </li>
              <li>
                <strong className="text-neutral-900">Zero-Snap Precision:</strong> Keeps cuts right at zero-voltage crossings, preventing sharp speaker clicks at start/end of training samples.
              </li>
              <li>
                <strong className="text-neutral-900">Check Spectrogram for Hiss & Hum:</strong> Inspect the lower panel for solid horizontal lines (50/60Hz ground hum) or diffuse blur above 6kHz (ambient air hiss).
              </li>
              <li>
                <strong className="text-neutral-900">Continuous Loop Playback:</strong> Hit <kbd className="px-1 py-0.2 bg-black text-white font-mono text-[10px] rounded font-bold">L</kbd> to loop the active slice continuously while writing or proofreading transcript text.
              </li>
              <li>
                <strong className="text-neutral-900">Export Standard Format:</strong> Packages individual 16-bit PCM Mono WAV clips alongside matching <code>.txt</code> files and LJSpeech <code>metadata.csv</code>.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-neutral-50 border-t border-neutral-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-black hover:bg-neutral-800 text-white rounded-lg text-xs font-semibold transition shadow-sm"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
