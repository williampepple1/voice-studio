import React, { useState, useMemo } from 'react';
import {
  Tag,
  X,
  ArrowRight,
  CheckCircle2,
  Layers
} from 'lucide-react';
import { AudioSegment, BulkRenameOptions } from '../types/audio';

interface BulkRenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  onApplyBulkRename: (options: BulkRenameOptions) => void;
}

export const BulkRenameModal: React.FC<BulkRenameModalProps> = ({
  isOpen,
  onClose,
  segments,
  onApplyBulkRename,
}) => {
  const [prefix, setPrefix] = useState('speaker1_');
  const [suffix, setSuffix] = useState('');
  const [startNumber, setStartNumber] = useState(1);
  const [padDigits, setPadDigits] = useState(3);

  const presets = [
    { label: 'speaker1_', prefix: 'speaker1_', suffix: '', pad: 3 },
    { label: 'clip_', prefix: 'clip_', suffix: '', pad: 3 },
    { label: 'voice_en_', prefix: 'voice_en_', suffix: '', pad: 3 },
    { label: 'audio_take_', prefix: 'audio_take_', suffix: '', pad: 4 },
    { label: 'sample_', prefix: 'sample_', suffix: '', pad: 2 },
  ];

  const generateNewId = (index: number) => {
    const num = startNumber + index;
    const numStr = String(num).padStart(padDigits, '0');
    return `${prefix}${numStr}${suffix}`;
  };

  const previewItems = useMemo(() => {
    if (segments.length === 0) return [];
    const sampleIndices =
      segments.length <= 5
        ? segments.map((_, i) => i)
        : [0, 1, 2, segments.length - 1];

    return sampleIndices.map((idx) => ({
      originalId: segments[idx].id,
      newId: generateNewId(idx),
      isLast: idx === segments.length - 1 && segments.length > 5,
    }));
  }, [segments, prefix, suffix, startNumber, padDigits]);

  if (!isOpen) return null;

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefix.trim() && !suffix.trim()) {
      alert('Please specify at least a prefix or suffix.');
      return;
    }
    onApplyBulkRename({
      prefix,
      suffix,
      startNumber,
      padDigits,
      pattern: '{prefix}{num}{suffix}',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                Bulk Rename Segments
              </h2>
              <p className="text-[11px] text-neutral-500">
                Format IDs for all {segments.length} audio clips & text files
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

        {/* Form Body */}
        <form onSubmit={handleApply} className="p-6 space-y-5">
          {/* Quick Presets */}
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-600 font-medium">Quick Presets:</label>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setPrefix(p.prefix);
                    setSuffix(p.suffix);
                    setPadDigits(p.pad);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-lg border font-mono transition ${
                    prefix === p.prefix && suffix === p.suffix && padDigits === p.pad
                      ? 'bg-black text-white border-black font-semibold'
                      : 'bg-neutral-100 border-neutral-300 text-neutral-700 hover:text-black hover:bg-neutral-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prefix & Suffix Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 font-medium">
                Custom Prefix:
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. speaker1_"
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 focus:outline-none focus:border-black"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 font-medium">
                Suffix (optional):
              </label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="e.g. _clean"
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 focus:outline-none focus:border-black"
              />
            </div>
          </div>

          {/* Numbering Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 font-medium">
                Start Number:
              </label>
              <input
                type="number"
                min="0"
                max="99999"
                value={startNumber}
                onChange={(e) => setStartNumber(parseInt(e.target.value) || 0)}
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 focus:outline-none focus:border-black"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 font-medium">
                Digit Zero-Padding:
              </label>
              <select
                value={padDigits}
                onChange={(e) => setPadDigits(parseInt(e.target.value))}
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 focus:outline-none focus:border-black"
              >
                <option value={1}>1 digit (1, 2, 3...)</option>
                <option value={2}>2 digits (01, 02...)</option>
                <option value={3}>3 digits (001, 002...)</option>
                <option value={4}>4 digits (0001, 0002...)</option>
                <option value={5}>5 digits (00001, 00002...)</option>
              </select>
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-neutral-700 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-neutral-500" />
                <span>Live Renaming Preview:</span>
              </span>
              <span className="text-[11px] text-neutral-500 font-mono">
                {segments.length} clips total
              </span>
            </div>

            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-1.5 font-mono text-xs max-h-40 overflow-y-auto">
              {previewItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 border-b border-neutral-200 last:border-0">
                  <span className="text-neutral-500 truncate max-w-[140px]">{item.originalId}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-400 shrink-0 mx-2" />
                  <span className="text-neutral-900 font-bold truncate max-w-[200px] text-right">
                    {item.newId}
                    <span className="text-neutral-500 text-[10px] font-normal ml-1">(.wav/.txt)</span>
                  </span>
                </div>
              ))}
              {segments.length > 5 && (
                <div className="text-[11px] text-neutral-500 text-center py-0.5">
                  ... and {segments.length - 4} more segments will be renamed ...
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-neutral-600 hover:text-black transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Apply to All {segments.length} Segments</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
