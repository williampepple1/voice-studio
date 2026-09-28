import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Scissors,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  MoveHorizontal,
  Magnet,
  Trash2,
  Flame,
  Info,
  Waves,
} from 'lucide-react';
import { AudioSegment } from '../types/audio';
import { formatTime } from '../utils/wavEncoder';
import { findNearestZeroCrossing } from '../utils/silenceDetector';
import { generateSpectrogramImageData } from '../utils/spectrogram';

interface WaveformEditorProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  segments: AudioSegment[];
  activeSegmentId: string | null;
  onSeek: (time: number) => void;
  onAddSplit: (time: number) => void;
  onUpdateSegmentTimes: (id: string, startTime: number, endTime: number) => void;
  onSelectSegment: (id: string) => void;
  onDeleteSplit: (index: number) => void;
  onAutoDetectSilence: () => void;
  onOpenDeReverb?: () => void;
}

export const WaveformEditor: React.FC<WaveformEditorProps> = ({
  audioBuffer,
  currentTime,
  segments,
  activeSegmentId,
  onSeek,
  onAddSplit,
  onUpdateSegmentTimes,
  onSelectSegment,
  onDeleteSplit,
  onAutoDetectSilence,
  onOpenDeReverb,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenSpectrogramRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState<number>(1.0);
  const [snapToZeroCrossing, setSnapToZeroCrossing] = useState<boolean>(true);
  const [cutModeActive, setCutModeActive] = useState<boolean>(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [draggingSplitIndex, setDraggingSplitIndex] = useState<number | null>(null);

  // Spectrogram controls
  const [showSpectrogram, setShowSpectrogram] = useState<boolean>(true);
  const [spectrogramFloorDb, setSpectrogramFloorDb] = useState<number>(-75);
  const [showNoiseGuide, setShowNoiseGuide] = useState<boolean>(false);

  const duration = audioBuffer ? audioBuffer.duration : 0;
  const sampleRate = audioBuffer ? audioBuffer.sampleRate : 44100;
  const nyquistKhz = Math.round(sampleRate / 2000);

  // Pre-calculate peak min/max arrays for fast rendering at 2400 samples per full viewport
  const peaks = useMemo(() => {
    if (!audioBuffer) return null;
    const channelData = audioBuffer.getChannelData(0);
    const numPoints = 2400;
    const blockSize = Math.floor(channelData.length / numPoints);
    const minPeaks = new Float32Array(numPoints);
    const maxPeaks = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
      let min = 1.0;
      let max = -1.0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      for (let j = start; j < end; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      minPeaks[i] = min === 1.0 ? 0 : min;
      maxPeaks[i] = max === -1.0 ? 0 : max;
    }
    return { minPeaks, maxPeaks };
  }, [audioBuffer]);

  const [viewportWidth, setViewportWidth] = useState(800);
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportWidth(containerRef.current.clientWidth);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const totalCanvasWidth = Math.max(viewportWidth, Math.round(viewportWidth * zoom));

  const timeToPx = useCallback((t: number) => {
    if (!duration) return 0;
    return (t / duration) * totalCanvasWidth;
  }, [duration, totalCanvasWidth]);

  const pxToTime = useCallback((px: number) => {
    if (!totalCanvasWidth || !duration) return 0;
    return Math.max(0, Math.min(duration, (px / totalCanvasWidth) * duration));
  }, [totalCanvasWidth, duration]);

  // Precompute spectrogram offscreen canvas when buffer or floor dB changes
  useEffect(() => {
    if (!audioBuffer || !showSpectrogram) return;

    try {
      const { imageData, width, height } = generateSpectrogramImageData(audioBuffer, {
        fftSize: 512,
        minDecibels: spectrogramFloorDb,
        maxDecibels: -10,
      });

      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.putImageData(imageData, 0, 0);
        offscreenSpectrogramRef.current = offscreen;
      }
    } catch (err) {
      console.error('Failed to compute spectrogram:', err);
    }
  }, [audioBuffer, showSpectrogram, spectrogramFloorDb]);

  // Auto-scroll waveform container to keep playhead in view during playback
  useEffect(() => {
    if (!containerRef.current || zoom <= 1.0) return;
    const playheadPx = timeToPx(currentTime);
    const scrollLeft = containerRef.current.scrollLeft;
    const clientWidth = containerRef.current.clientWidth;

    if (playheadPx > scrollLeft + clientWidth - 100 || playheadPx < scrollLeft + 50) {
      containerRef.current.scrollLeft = Math.max(0, playheadPx - clientWidth / 3);
    }
  }, [currentTime, zoom, timeToPx]);

  // Draw ruler canvas
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas || !duration) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 26;
    canvas.width = totalCanvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalCanvasWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalCanvasWidth, height);

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, totalCanvasWidth, height);

    let stepSec = 1.0;
    if (totalCanvasWidth / duration < 30) stepSec = 5.0;
    else if (totalCanvasWidth / duration < 80) stepSec = 2.0;
    else if (totalCanvasWidth / duration > 300) stepSec = 0.5;
    else if (totalCanvasWidth / duration > 800) stepSec = 0.2;

    ctx.fillStyle = '#525252';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.strokeStyle = '#d4d4d4';
    ctx.lineWidth = 1;

    for (let t = 0; t <= duration; t += stepSec) {
      const x = Math.round(timeToPx(t));
      ctx.beginPath();
      ctx.moveTo(x, height - 8);
      ctx.lineTo(x, height);
      ctx.stroke();

      const text = formatTime(t).substring(3);
      ctx.fillText(text, x + 3, height - 10);
    }

    const minorStep = stepSec / 5;
    ctx.strokeStyle = '#e5e5e5';
    for (let t = 0; t <= duration; t += minorStep) {
      const x = Math.round(timeToPx(t));
      ctx.beginPath();
      ctx.moveTo(x, height - 4);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [duration, totalCanvasWidth, timeToPx]);

  // Draw main audio waveform canvas (Light Theme / White Background)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !duration) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 140;
    canvas.width = totalCanvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalCanvasWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalCanvasWidth, height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalCanvasWidth, height);

    const centerY = height / 2;
    const maxAmplitudeY = (height / 2) * 0.88;

    // Center baseline
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(totalCanvasWidth, centerY);
    ctx.stroke();

    // 1. Draw segment background blocks
    segments.forEach((seg, idx) => {
      const startX = timeToPx(seg.startTime);
      const endX = timeToPx(seg.endTime);
      const segWidth = Math.max(1, endX - startX);
      const isActive = seg.id === activeSegmentId;

      ctx.fillStyle = isActive
        ? 'rgba(0, 0, 0, 0.06)'
        : idx % 2 === 0
        ? 'rgba(0, 0, 0, 0.015)'
        : 'rgba(0, 0, 0, 0.035)';
      ctx.fillRect(startX, 0, segWidth, height);

      if (isActive) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(startX + 1, 1, segWidth - 2, height - 2);
      }
    });

    // 2. Draw waveform bars
    const numBars = peaks.minPeaks.length;
    for (let i = 0; i < numBars; i++) {
      const x = (i / numBars) * totalCanvasWidth;
      const barTime = (i / numBars) * duration;

      const segIndex = segments.findIndex(
        s => barTime >= s.startTime && barTime <= s.endTime
      );
      const isSegmentActive =
        segIndex !== -1 && segments[segIndex]?.id === activeSegmentId;

      const minVal = peaks.minPeaks[i];
      const maxVal = peaks.maxPeaks[i];
      const topY = centerY - maxVal * maxAmplitudeY;
      const botY = centerY - minVal * maxAmplitudeY;
      const barHeight = Math.max(2, botY - topY);

      if (isSegmentActive) {
        ctx.fillStyle = '#000000';
      } else if (segIndex !== -1) {
        ctx.fillStyle = segIndex % 2 === 0 ? '#525252' : '#737373';
      } else {
        ctx.fillStyle = '#a3a3a3';
      }

      ctx.fillRect(x, topY, Math.max(1, totalCanvasWidth / numBars - 0.5), barHeight);
    }

    // 3. Hover indicator line
    if (hoverTime !== null && hoverTime >= 0 && hoverTime <= duration) {
      const hoverX = Math.round(timeToPx(hoverTime));
      ctx.strokeStyle = '#525252';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. Playhead line (Solid Black)
    const playheadX = Math.round(timeToPx(currentTime));
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 0);
    ctx.lineTo(playheadX + 5, 0);
    ctx.lineTo(playheadX, 8);
    ctx.closePath();
    ctx.fill();
  }, [peaks, duration, totalCanvasWidth, segments, activeSegmentId, currentTime, hoverTime, timeToPx]);

  // Draw audio spectrogram canvas (Paper sonogram on white background)
  useEffect(() => {
    if (!showSpectrogram) return;
    const canvas = spectrogramCanvasRef.current;
    const offscreen = offscreenSpectrogramRef.current;
    if (!canvas || !offscreen || !duration) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 120;
    canvas.width = totalCanvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalCanvasWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalCanvasWidth, height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalCanvasWidth, height);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, totalCanvasWidth, height);

    // Reference frequency guidelines
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);

    const freqGuides = [1000, 2500, 5000, 8000];
    const maxFreq = sampleRate / 2;
    freqGuides.forEach((freq) => {
      if (freq < maxFreq) {
        const y = height - (freq / maxFreq) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(totalCanvasWidth, y);
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);

    // Segment active border
    segments.forEach((seg) => {
      const startX = timeToPx(seg.startTime);
      const endX = timeToPx(seg.endTime);
      const segWidth = Math.max(1, endX - startX);
      const isActive = seg.id === activeSegmentId;

      if (isActive) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
        ctx.fillRect(startX, 0, segWidth, height);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, 0, segWidth, height);
      }
    });

    // Playhead line
    const playheadX = Math.round(timeToPx(currentTime));
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Hover line
    if (hoverTime !== null && hoverTime >= 0 && hoverTime <= duration) {
      const hoverX = Math.round(timeToPx(hoverTime));
      ctx.strokeStyle = '#525252';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [showSpectrogram, duration, totalCanvasWidth, segments, activeSegmentId, currentTime, hoverTime, timeToPx, sampleRate]);

  // Handle clicking on waveform canvas to add split or seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !duration || draggingSplitIndex !== null) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickPx = e.clientX - rect.left;
    let targetTime = pxToTime(clickPx);

    if (snapToZeroCrossing && audioBuffer) {
      targetTime = findNearestZeroCrossing(audioBuffer, targetTime);
    }

    if (cutModeActive) {
      onAddSplit(targetTime);
    } else {
      onSeek(targetTime);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !duration) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mousePx = e.clientX - rect.left;
    let t = pxToTime(mousePx);

    if (snapToZeroCrossing && audioBuffer) {
      t = findNearestZeroCrossing(audioBuffer, t);
    }

    setHoverTime(t);

    if (draggingSplitIndex !== null) {
      const segA = segments[draggingSplitIndex];
      const segB = segments[draggingSplitIndex + 1];
      if (segA && segB) {
        const minBound = segA.startTime + 0.1;
        const maxBound = segB.endTime - 0.1;
        const newTime = Math.max(minBound, Math.min(maxBound, t));
        onUpdateSegmentTimes(segA.id, segA.startTime, newTime);
        onUpdateSegmentTimes(segB.id, newTime, segB.endTime);
      }
    }
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    if (draggingSplitIndex !== null) {
      setDraggingSplitIndex(null);
    }
  };

  const handleMouseUp = () => {
    if (draggingSplitIndex !== null) {
      setDraggingSplitIndex(null);
    }
  };

  return (
    <div className="flex flex-col bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
      {/* Top Deck Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-white border-b border-neutral-200 gap-3">
        {/* Left: Mode Switchers */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCutModeActive(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition border ${
              cutModeActive
                ? 'bg-black text-white border-black shadow-sm'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 border-neutral-300'
            }`}
            title="Click directly on the waveform to cut into audio segments"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cut Tool</span>
          </button>

          <button
            onClick={() => setCutModeActive(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition border ${
              !cutModeActive
                ? 'bg-black text-white border-black shadow-sm'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 border-neutral-300'
            }`}
            title="Click to move playhead without splitting"
          >
            <MoveHorizontal className="w-3.5 h-3.5" />
            <span>Scrub Tool</span>
          </button>

          <div className="h-4 w-px bg-neutral-200 mx-1" />

          {/* Zero-crossing snap */}
          <button
            onClick={() => setSnapToZeroCrossing(!snapToZeroCrossing)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition border ${
              snapToZeroCrossing
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-neutral-100 text-neutral-600 border-neutral-300 hover:bg-neutral-200 hover:text-black'
            }`}
            title="Snap cuts to nearest zero-crossings to avoid audible clicks"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Zero-Snap {snapToZeroCrossing ? 'ON' : 'OFF'}</span>
          </button>

          {/* Quick Split at Playhead */}
          <button
            onClick={() => onAddSplit(currentTime)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 transition"
            title="Split at Current Playhead (Shortcut: S key)"
          >
            <Scissors className="w-3.5 h-3.5 text-neutral-600" />
            <span>Cut Playhead</span>
            <span className="ml-1 text-[10px] text-neutral-500 font-mono">[S]</span>
          </button>
        </div>

        {/* Right: Spectrogram toggle, Noise guide & Zoom controls */}
        <div className="flex items-center gap-2">
          {/* Spectrogram View Toggle */}
          <button
            onClick={() => setShowSpectrogram(!showSpectrogram)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              showSpectrogram
                ? 'bg-neutral-900 text-white border-neutral-900 shadow-sm'
                : 'bg-neutral-100 text-neutral-600 border-neutral-300 hover:bg-neutral-200 hover:text-black'
            }`}
            title="Toggle monochromatic audio spectrogram visualization"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Spectrogram {showSpectrogram ? 'ON' : 'OFF'}</span>
          </button>

          {/* Spectrogram Sensitivity Slider */}
          {showSpectrogram && (
            <div className="hidden sm:flex items-center gap-2 bg-neutral-50 px-2.5 py-1 rounded-lg border border-neutral-200 text-xs">
              <span className="text-[11px] text-neutral-500">dB Floor:</span>
              <input
                type="range"
                min="-95"
                max="-50"
                step="5"
                value={spectrogramFloorDb}
                onChange={(e) => setSpectrogramFloorDb(parseInt(e.target.value))}
                className="w-16 h-1 bg-neutral-300 rounded appearance-none cursor-pointer accent-black"
                title={`Spectrogram noise sensitivity floor: ${spectrogramFloorDb} dB`}
              />
              <span className="font-mono text-[10px] text-neutral-800 font-semibold w-9 text-right">
                {spectrogramFloorDb}dB
              </span>

              {/* Artifacts Guide Trigger */}
              <button
                onClick={() => setShowNoiseGuide(!showNoiseGuide)}
                className="p-1 text-neutral-400 hover:text-black rounded transition ml-0.5"
                title="How to spot audio artifacts and noise on the spectrogram"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Auto-Detect Silence */}
          <button
            onClick={onAutoDetectSilence}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 transition shadow-sm"
            title="Auto-detect spoken sentence pauses and generate suggested cuts"
          >
            <Sparkles className="w-3.5 h-3.5 text-neutral-600" />
            <span>Auto-Silence</span>
          </button>

          {/* De-Reverb Acoustic Cleaner */}
          {onOpenDeReverb && (
            <button
              onClick={onOpenDeReverb}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-300 transition shadow-sm"
              title="Acoustic De-Reverb: suppress mic room reflections and echo tails"
            >
              <Waves className="w-3.5 h-3.5 text-black" />
              <span>De-Reverb</span>
            </button>
          )}

          <div className="h-4 w-px bg-neutral-200 mx-0.5" />

          {/* Zoom controls */}
          <div className="flex items-center bg-neutral-100 rounded-lg p-0.5 border border-neutral-300">
            <button
              onClick={() => setZoom(prev => Math.max(1.0, Number((prev / 1.5).toFixed(2))))}
              disabled={zoom <= 1.0}
              className="p-1.5 text-neutral-500 hover:text-black disabled:opacity-30 disabled:hover:text-neutral-500 rounded transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-neutral-700 px-2 select-none min-w-[42px] text-center font-semibold">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(prev => Math.min(16.0, Number((prev * 1.5).toFixed(2))))}
              disabled={zoom >= 16.0}
              className="p-1.5 text-neutral-500 hover:text-black disabled:opacity-30 disabled:hover:text-neutral-500 rounded transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom(1.0)}
              className="p-1.5 text-neutral-500 hover:text-black rounded transition ml-0.5"
              title="Reset Zoom to Fit"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Artifacts Guide Alert Banner */}
      {showNoiseGuide && showSpectrogram && (
        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 text-xs text-neutral-700 flex flex-wrap items-center justify-between gap-4 animate-in fade-in duration-150">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-semibold text-neutral-900 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-neutral-700" />
              <span>Spectrogram Acoustic Guide:</span>
            </span>
            <span className="text-neutral-600">
              <strong className="text-neutral-900">Horizontal streak:</strong> Electrical hum (50/60Hz) or continuous fan noise.
            </span>
            <span className="text-neutral-600">
              <strong className="text-neutral-900">Upper blur (&gt;6kHz):</strong> Microphone hiss, room AC, or sibilant 's' harshness.
            </span>
            <span className="text-neutral-600">
              <strong className="text-neutral-900">Vertical spikes:</strong> Sudden mouth clicks, pops, or table thuds.
            </span>
          </div>
          <button
            onClick={() => setShowNoiseGuide(false)}
            className="text-neutral-500 hover:text-black text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Synchronized Waveform & Spectrogram Scroll Area */}
      <div
        ref={containerRef}
        className="relative overflow-x-auto overflow-y-hidden select-none bg-white scrollbar-thin scrollbar-thumb-neutral-300 scrollbar-track-neutral-100 cursor-crosshair"
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
      >
        {/* Timeline Ruler */}
        <canvas ref={rulerCanvasRef} className="block border-b border-neutral-200" />

        {/* Amplitude Waveform Canvas */}
        <canvas ref={canvasRef} className="block" />

        {/* Audio Spectrogram Canvas (Below Waveform) */}
        {showSpectrogram && (
          <div className="relative border-t border-neutral-200 bg-white">
            {/* Frequency Axis Overlay */}
            <div className="absolute left-2 top-1.5 bottom-1.5 flex flex-col justify-between text-[9px] font-mono text-neutral-600 select-none pointer-events-none z-10 bg-white/90 px-1.5 py-1 rounded border border-neutral-200 shadow-sm backdrop-blur-sm">
              <span className="text-neutral-900 font-semibold">{nyquistKhz} kHz (Nyquist)</span>
              <span>{Math.round(nyquistKhz * 0.6)} kHz</span>
              <span>{Math.round(nyquistKhz * 0.3)} kHz</span>
              <span>1.0 kHz</span>
              <span className="text-neutral-400">0 Hz</span>
            </div>

            {/* Spectrogram Canvas */}
            <canvas ref={spectrogramCanvasRef} className="block" />
          </div>
        )}

        {/* Continuous Split Cut Handles & Badges across Waveform and Spectrogram */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ width: `${totalCanvasWidth}px`, height: '100%' }}
        >
          {segments.map((seg, idx) => {
            const startX = timeToPx(seg.startTime);
            const endX = timeToPx(seg.endTime);
            const isSelected = seg.id === activeSegmentId;

            return (
              <React.Fragment key={seg.id}>
                {/* Segment Tag Badge */}
                <div
                  className={`absolute top-7 pointer-events-auto px-2 py-0.5 rounded text-[11px] font-mono font-semibold tracking-tight transition cursor-pointer flex items-center gap-1.5 shadow-sm ${
                    isSelected
                      ? 'bg-black text-white ring-2 ring-neutral-400 z-20'
                      : 'bg-white text-neutral-800 hover:bg-neutral-100 border border-neutral-300 z-10'
                  }`}
                  style={{ left: `${startX + 8}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSegment(seg.id);
                  }}
                  title={`Segment ${seg.id} (${(seg.endTime - seg.startTime).toFixed(2)}s)`}
                >
                  <span>{seg.id}</span>
                  <span className="text-[10px] opacity-75">
                    {(seg.endTime - seg.startTime).toFixed(2)}s
                  </span>
                </div>

                {/* Split boundary marker line */}
                {idx < segments.length - 1 && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-auto flex items-center justify-center group cursor-ew-resize z-30"
                    style={{ left: `${endX - 7}px`, width: '14px' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingSplitIndex(idx);
                    }}
                    title="Drag to adjust split time, or click to delete cut"
                  >
                    {/* Visual cut line */}
                    <div className="w-[2px] h-full bg-neutral-400 group-hover:w-[3px] group-hover:bg-black transition" />

                    {/* Quick remove cut button on hover */}
                    <button
                      className="absolute top-2 w-5 h-5 bg-neutral-900 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow transition -translate-y-1 group-hover:translate-y-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSplit(idx);
                      }}
                      title="Merge adjacent clips (remove split)"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Waveform Bottom Status Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-neutral-50 text-xs text-neutral-600 border-t border-neutral-200 gap-3">
        <div className="flex items-center gap-4 font-mono text-[11px] flex-wrap">
          <div>
            <span className="text-neutral-400">Playhead: </span>
            <span className="text-black font-bold">{formatTime(currentTime)}</span>
          </div>
          {hoverTime !== null && (
            <div>
              <span className="text-neutral-400">Cursor: </span>
              <span className="text-neutral-800 font-medium">{formatTime(hoverTime)}</span>
            </div>
          )}
          <div>
            <span className="text-neutral-400">Duration: </span>
            <span className="text-neutral-700">{formatTime(duration)}</span>
          </div>
          <div>
            <span className="text-neutral-400">Segments: </span>
            <span className="text-neutral-900 font-semibold">{segments.length}</span>
          </div>
          {showSpectrogram && (
            <div className="hidden sm:inline-flex items-center gap-1 text-neutral-700 text-[10px]">
              <Flame className="w-3 h-3 text-neutral-500" />
              <span>Spectrogram Active (0Hz - {nyquistKhz}kHz)</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="hidden sm:inline text-neutral-500">
            {cutModeActive ? (
              <span className="text-black font-semibold">Click anywhere on waveform to cut segment</span>
            ) : (
              <span className="text-neutral-700">Click anywhere to seek playhead</span>
            )}
          </span>
          <span className="text-neutral-300">•</span>
          <span className="text-neutral-500">Drag cut lines to fine-tune</span>
        </div>
      </div>
    </div>
  );
};
