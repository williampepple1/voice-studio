import React, { useState } from 'react';
import JSZip from 'jszip';
import {
  Download,
  X,
  FolderArchive,
  Layers,
  Settings
} from 'lucide-react';
import { AudioSegment, ExportSettings } from '../types/audio';
import { encodeAudioSegmentToWav, formatTime } from '../utils/wavEncoder';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  audioBuffer: AudioBuffer | null;
  exportSettings: ExportSettings;
  onUpdateExportSettings: (settings: Partial<ExportSettings>) => void;
  projectName: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  segments,
  audioBuffer,
  exportSettings,
  onUpdateExportSettings,
  projectName,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentProcessingClip, setCurrentProcessingClip] = useState('');

  if (!isOpen) return null;

  const totalClips = segments.length;
  const annotatedClips = segments.filter(s => s.text.trim().length > 0).length;
  const unannotatedClips = totalClips - annotatedClips;
  const totalDuration = segments.reduce((acc, s) => acc + (s.endTime - s.startTime), 0);
  const avgDuration = totalClips > 0 ? totalDuration / totalClips : 0;

  const handleStartExport = async () => {
    if (!audioBuffer || segments.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const zip = new JSZip();
      const wavsFolder = zip.folder('wavs') || zip;
      const txtsFolder = zip.folder('text') || zip;

      const metadataRows: string[] = [];
      const manifestList: any[] = [];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        setCurrentProcessingClip(seg.id);

        const { blob, duration } = await encodeAudioSegmentToWav(
          audioBuffer,
          seg.startTime,
          seg.endTime,
          {
            sampleRate: exportSettings.sampleRate,
            channels: exportSettings.channels,
            normalize: exportSettings.normalizeAudio,
            targetPeakDb: exportSettings.targetPeakDb,
            microFade: exportSettings.applyMicroFade,
            deReverb: exportSettings.applyDeReverb,
            extractMusic: exportSettings.applyMusicExtraction,
          }
        );

        const wavFilename = `${seg.id}.wav`;
        const wavArrayBuffer = await blob.arrayBuffer();
        zip.file(wavFilename, wavArrayBuffer);
        wavsFolder.file(wavFilename, wavArrayBuffer);

        const txtFilename = `${seg.id}.txt`;
        const textContent = seg.text.trim();
        zip.file(txtFilename, textContent);
        txtsFolder.file(txtFilename, textContent);

        const cleanText = textContent.replace(/\|/g, ' ');
        metadataRows.push(`${seg.id}|${cleanText}|${cleanText}`);
        manifestList.push({
          id: seg.id,
          audio_filepath: `wavs/${wavFilename}`,
          text: cleanText,
          duration: Number(duration.toFixed(3)),
          start_time: Number(seg.startTime.toFixed(3)),
          end_time: Number(seg.endTime.toFixed(3)),
        });

        const pct = Math.round(((i + 1) / segments.length) * 100);
        setExportProgress(pct);
      }

      if (exportSettings.includeCsv) {
        const csvContent = metadataRows.join('\n');
        zip.file('metadata.csv', csvContent);
      }

      if (exportSettings.includeJson) {
        const jsonContent = JSON.stringify(manifestList, null, 2);
        zip.file('manifest.json', jsonContent);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setExportProgress(Math.round(metadata.percent));
      });

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const cleanProjectName = (projectName || 'tts_dataset').replace(/\.[^/.]+$/, '');
      a.download = `${cleanProjectName}_tts_dataset.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to package training dataset ZIP. Check console for error details.');
    } finally {
      setIsExporting(false);
      setCurrentProcessingClip('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center">
              <FolderArchive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-900 tracking-tight">
                Export TTS Training Dataset
              </h2>
              <p className="text-[11px] text-neutral-500">
                Paired WAV audio clips & matching TXT transcripts inside ZIP
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Quick Metrics */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200">
              <span className="text-[10px] text-neutral-500 block uppercase font-mono">Clips</span>
              <span className="text-base font-mono font-bold text-neutral-900">{totalClips}</span>
            </div>
            <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200">
              <span className="text-[10px] text-neutral-500 block uppercase font-mono">Annotated</span>
              <span className="text-base font-mono font-bold text-neutral-900">{annotatedClips}</span>
            </div>
            <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200">
              <span className="text-[10px] text-neutral-500 block uppercase font-mono">Duration</span>
              <span className="text-base font-mono font-bold text-neutral-800">{formatTime(totalDuration)}</span>
            </div>
            <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200">
              <span className="text-[10px] text-neutral-500 block uppercase font-mono">Avg Length</span>
              <span className="text-base font-mono font-bold text-neutral-700">{avgDuration.toFixed(1)}s</span>
            </div>
          </div>

          {unannotatedClips > 0 && (
            <div className="p-3 bg-neutral-100 border border-neutral-300 rounded-lg text-xs text-neutral-800">
              Notice: {unannotatedClips} clips have empty transcripts. They will still be packaged as audio with blank .txt files.
            </div>
          )}

          {/* Archive Tree */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-neutral-500" />
              <span>Archive Layout Preview:</span>
            </span>
            <div className="font-mono text-xs text-neutral-700 bg-neutral-50 p-3 rounded-lg border border-neutral-200 space-y-1">
              <div className="text-neutral-900 font-bold">📦 {projectName || 'tts_dataset'}.zip</div>
              <div className="pl-4 text-neutral-800">├── clip_001.wav &nbsp;&nbsp;(16-bit PCM {exportSettings.sampleRate}Hz)</div>
              <div className="pl-4 text-neutral-600">├── clip_001.txt &nbsp;&nbsp;(matching transcript)</div>
              <div className="pl-4 text-neutral-800">├── clip_002.wav</div>
              <div className="pl-4 text-neutral-600">├── clip_002.txt</div>
              <div className="pl-4 text-neutral-400">├── ...</div>
              {exportSettings.includeCsv && (
                <div className="pl-4 text-neutral-600">├── metadata.csv (LJSpeech standard)</div>
              )}
            </div>
          </div>

          {/* DSP / Acoustic Configuration */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 text-neutral-500" />
              <span>Acoustic Encoding Settings</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-600">Sample Rate:</label>
                <select
                  value={exportSettings.sampleRate}
                  onChange={(e) => onUpdateExportSettings({ sampleRate: parseInt(e.target.value) as any })}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-black font-mono"
                >
                  <option value={22050}>22,050 Hz (Default for Piper, VITS)</option>
                  <option value={24000}>24,000 Hz (StyleTTS 2, Bark)</option>
                  <option value={44100}>44,100 Hz (CD Quality)</option>
                  <option value={48000}>48,000 Hz (Mastering)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-neutral-600">Audio Channels:</label>
                <select
                  value={exportSettings.channels}
                  onChange={(e) => onUpdateExportSettings({ channels: parseInt(e.target.value) as 1 | 2 })}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-black font-mono"
                >
                  <option value={1}>Mono (Recommended for TTS)</option>
                  <option value={2}>Stereo (2 Channels)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSettings.normalizeAudio}
                  onChange={(e) => onUpdateExportSettings({ normalizeAudio: e.target.checked })}
                  className="w-4 h-4 rounded bg-white border-neutral-300 text-black focus:ring-0 accent-black"
                />
                <span>Peak normalization to -1.0 dB across all slices</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSettings.applyMicroFade}
                  onChange={(e) => onUpdateExportSettings({ applyMicroFade: e.target.checked })}
                  className="w-4 h-4 rounded bg-white border-neutral-300 text-black focus:ring-0 accent-black"
                />
                <span>Micro crossfade anti-click (5ms) on cut boundaries</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSettings.applyDeReverb || false}
                  onChange={(e) => onUpdateExportSettings({ applyDeReverb: e.target.checked })}
                  className="w-4 h-4 rounded bg-white border-neutral-300 text-black focus:ring-0 accent-black"
                />
                <span>Apply De-Reverberation (room reflection & echo suppression) to all exported clips</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSettings.applyMusicExtraction || false}
                  onChange={(e) => onUpdateExportSettings({ applyMusicExtraction: e.target.checked })}
                  className="w-4 h-4 rounded bg-white border-neutral-300 text-black focus:ring-0 accent-black"
                />
                <span>Extract & Strip Background Music (spectral vocal isolation on all exported clips)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSettings.includeCsv}
                  onChange={(e) => onUpdateExportSettings({ includeCsv: e.target.checked })}
                  className="w-4 h-4 rounded bg-white border-neutral-300 text-black focus:ring-0 accent-black"
                />
                <span>Include LJSpeech metadata.csv (id|transcript|transcript)</span>
              </label>
            </div>
          </div>

          {/* Progress */}
          {isExporting && (
            <div className="space-y-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-900 font-mono font-medium">{currentProcessingClip}</span>
                <span className="font-mono text-neutral-600">{exportProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black transition-all duration-100"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-neutral-50 border-t border-neutral-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-xs font-medium text-neutral-600 hover:text-black"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleStartExport}
            disabled={isExporting || totalClips === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black hover:bg-neutral-800 text-white font-semibold text-xs shadow-sm disabled:opacity-30 transition"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'Encoding...' : `Export ZIP (${totalClips} WAV + TXT)`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
