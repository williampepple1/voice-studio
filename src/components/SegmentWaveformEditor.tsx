import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Scissors,
  MoveHorizontal,
  Magnet,
  Play,
  Pause,
  Repeat,
  Sparkles,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  ArrowRightLeft
} from 'lucide-react';
import { AudioSegment } from '../types/audio';
import { formatTime } from '../utils/wavEncoder';
import { findNearestZeroCrossing } from '../utils/silenceDetector';

interface SegmentWaveformEditorProps {
  audioBuffer: AudioBuffer | null;
  segment: AudioSegment;
  currentTime: number;
  isPlaying: boolean;
  isLooping: boolean;
  onSeek: (time: number) => void;
  onAddSplit: (time: number, selectSecondClip?: boolean) => void;
  onUpdateSegmentTimes: (id: string, startTime: number, endTime: number) => void;
  onPlaySegment: (id: string, loop?: boolean) => void;
  onStop: () => void;
}

export const SegmentWaveformEditor: React.FC<SegmentWaveformEditorProps> = ({
  audioBuffer,
  segment,
  currentTime,
  isPlaying,
  isLooping,
  onSeek,
  onAddSplit,
  onUpdateSegmentTimes,
  onPlaySegment,
  onStop,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cutMode, setCutMode] = useState<boolean>(true);
  const [snapToZero, setSnapToZero] = useState<boolean>(true);
  const [selectSecondAfterCut, setSelectSecondAfterCut] = useState<boolean>(true);
  const [gainBoost, setGainBoost] = useState<number>(1.0); // 1.0, 1.5, 2.0x amplitude zoom
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Dragging boundary handles
  const [isDraggingStart, setIsDraggingStart] = useState<boolean>(false);
  const [isDraggingEnd, setIsDraggingEnd] = useState<boolean>(false);

  const segmentDuration = Math.max(0.01, segment.endTime - segment.startTime);

  // Compute peak envelope for just this segment (800 points for smooth resolution)
  const segmentPeaks = useMemo(() => {
    if (!audioBuffer) return null;
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    const startSample = Math.max(0, Math.floor(segment.startTime * sampleRate));
    const endSample = Math.min(channelData.length, Math.ceil(segment.endTime * sampleRate));
    const totalSamples = endSample - startSample;

    if (totalSamples <= 0) return null;

    const numPoints = 800;
    const blockSize = Math.max(1, Math.floor(totalSamples / numPoints));
    const minPeaks = new Float32Array(numPoints);
    const maxPeaks = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
      let min = 1.0;
      let max = -1.0;
      const bStart = startSample + i * blockSize;
      const bEnd = Math.min(bStart + blockSize, endSample);

      for (let j = bStart; j < bEnd; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      minPeaks[i] = min === 1.0 ? 0 : min;
      maxPeaks[i] = max === -1.0 ? 0 : max;
    }

    return { minPeaks, maxPeaks };
  }, [audioBuffer, segment.startTime, segment.endTime]);

  const [canvasWidth, setCanvasWidth] = useState<number>(600);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setCanvasWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Time conversion helpers
  const timeToPx = useCallback(
    (t: number) => {
      const relTime = t - segment.startTime;
      return (relTime / segmentDuration) * canvasWidth;
    },
    [segment.startTime, segmentDuration, canvasWidth]
  );

  const pxToTime = useCallback(
    (px: number) => {
      const rel = (px / canvasWidth) * segmentDuration;
      return Math.max(segment.startTime, Math.min(segment.endTime, segment.startTime + rel));
    },
    [segment.startTime, segment.endTime, segmentDuration, canvasWidth]
  );

  // Draw relative ruler
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas || !segmentDuration) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 20;
    canvas.width = canvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, height);

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvasWidth, height);

    // Calculate tick step based on duration
    let stepSec = 0.5;
    if (segmentDuration < 1.0) stepSec = 0.1;
    else if (segmentDuration < 2.5) stepSec = 0.25;
    else if (segmentDuration < 6.0) stepSec = 0.5;
    else stepSec = 1.0;

    ctx.fillStyle = '#525252';
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.strokeStyle = '#d4d4d4';
    ctx.lineWidth = 1;

    for (let relT = 0; relT <= segmentDuration; relT += stepSec) {
      const x = Math.round((relT / segmentDuration) * canvasWidth);
      ctx.beginPath();
      ctx.moveTo(x, height - 6);
      ctx.lineTo(x, height);
      ctx.stroke();

      const label = `+${relT.toFixed(relT < 1 && stepSec < 0.2 ? 2 : 1)}s`;
      ctx.fillText(label, Math.max(2, Math.min(canvasWidth - 30, x + 2)), height - 8);
    }
  }, [canvasWidth, segmentDuration]);

  // Draw Segment Amplitude Waveform Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !segmentPeaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 90;
    canvas.width = canvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, height);

    // Pure white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, height);

    const centerY = height / 2;
    const maxAmplitudeY = (height / 2) * 0.9 * gainBoost;

    // Center baseline
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvasWidth, centerY);
    ctx.stroke();

    // Waveform bars
    const numBars = segmentPeaks.minPeaks.length;
    ctx.fillStyle = '#000000';

    for (let i = 0; i < numBars; i++) {
      const x = (i / numBars) * canvasWidth;
      const minVal = segmentPeaks.minPeaks[i];
      const maxVal = segmentPeaks.maxPeaks[i];

      const topY = Math.max(1, centerY - maxVal * maxAmplitudeY);
      const botY = Math.min(height - 1, centerY - minVal * maxAmplitudeY);
      const barHeight = Math.max(2, botY - topY);

      ctx.fillRect(x, topY, Math.max(1, canvasWidth / numBars - 0.3), barHeight);
    }

    // Playhead indicator (if playback is within this segment)
    if (currentTime >= segment.startTime && currentTime <= segment.endTime) {
      const playheadX = Math.round(timeToPx(currentTime));

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top needle triangle
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 0);
      ctx.lineTo(playheadX + 5, 0);
      ctx.lineTo(playheadX, 7);
      ctx.closePath();
      ctx.fill();
    }

    // Hover cut indicator
    if (hoverTime !== null && hoverTime >= segment.startTime && hoverTime <= segment.endTime) {
      const hoverX = Math.round(timeToPx(hoverTime));
      ctx.strokeStyle = '#000000';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [segmentPeaks, canvasWidth, currentTime, hoverTime, timeToPx, segment.startTime, segment.endTime, gainBoost]);

  // Click on waveform to cut or seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !audioBuffer) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickPx = e.clientX - rect.left;
    let clickTime = pxToTime(clickPx);

    if (snapToZero) {
      clickTime = findNearestZeroCrossing(audioBuffer, clickTime);
    }

    // Ensure within bounds
    clickTime = Math.max(segment.startTime + 0.05, Math.min(segment.endTime - 0.05, clickTime));

    if (cutMode) {
      onAddSplit(clickTime, selectSecondAfterCut);
    } else {
      onSeek(clickTime);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !audioBuffer) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mousePx = e.clientX - rect.left;
    let t = pxToTime(mousePx);

    if (snapToZero) {
      t = findNearestZeroCrossing(audioBuffer, t);
    }

    setHoverTime(t);

    if (isDraggingStart) {
      const newStart = Math.max(0, Math.min(segment.endTime - 0.1, t));
      onUpdateSegmentTimes(segment.id, newStart, segment.endTime);
    } else if (isDraggingEnd) {
      const newEnd = Math.max(segment.startTime + 0.1, t);
      onUpdateSegmentTimes(segment.id, segment.startTime, newEnd);
    }
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setIsDraggingStart(false);
    setIsDraggingEnd(false);
  };

  const handleMouseUp = () => {
    setIsDraggingStart(false);
    setIsDraggingEnd(false);
  };

  // Split at current playhead position
  const handleCutAtPlayhead = () => {
    if (currentTime > segment.startTime + 0.05 && currentTime < segment.endTime - 0.05) {
      let t = currentTime;
      if (snapToZero && audioBuffer) {
        t = findNearestZeroCrossing(audioBuffer, t);
      }
      onAddSplit(t, selectSecondAfterCut);
    }
  };

  const hoverRelTime = hoverTime !== null ? Math.max(0, hoverTime - segment.startTime) : null;

  return (
    <div className="bg-neutral-50 rounded-xl border border-neutral-200 overflow-hidden space-y-2 p-3">
      {/* Waveform Header & Precision Cutting Deck */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-neutral-900 flex items-center gap-1.5 text-xs">
            <Scissors className="w-3.5 h-3.5 text-black" />
            <span>Precision Waveform Cutter:</span>
          </span>

          {/* Mode Switchers */}
          <div className="flex items-center p-0.5 bg-neutral-200/80 rounded-lg border border-neutral-300">
            <button
              onClick={() => setCutMode(true)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
                cutMode
                  ? 'bg-black text-white shadow-sm'
                  : 'text-neutral-700 hover:text-black'
              }`}
              title="Click on the waveform to cut this segment into two pieces"
            >
              <Scissors className="w-3 h-3" />
              <span>Cut Tool</span>
            </button>
            <button
              onClick={() => setCutMode(false)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
                !cutMode
                  ? 'bg-black text-white shadow-sm'
                  : 'text-neutral-700 hover:text-black'
              }`}
              title="Click to seek playhead within this clip"
            >
              <MoveHorizontal className="w-3 h-3" />
              <span>Scrub</span>
            </button>
          </div>

          {/* Snap to Zero Crossing */}
          <button
            onClick={() => setSnapToZero(!snapToZero)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition border ${
              snapToZero
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-600 border-neutral-300 hover:text-black'
            }`}
            title="Snap cuts to nearest zero-crossings to avoid audible clicks"
          >
            <Magnet className="w-3 h-3" />
            <span>Zero-Snap {snapToZero ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Right Tools: Split at Playhead & Amplitude Boost */}
        <div className="flex items-center gap-2">
          {/* Quick Cut At Playhead */}
          <button
            onClick={handleCutAtPlayhead}
            disabled={
              currentTime <= segment.startTime + 0.05 || currentTime >= segment.endTime - 0.05
            }
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-900 font-semibold text-[11px] border border-neutral-300 disabled:opacity-40 transition shadow-sm"
            title="Split exactly at the current playhead position [S]"
          >
            <Scissors className="w-3 h-3 text-black" />
            <span>Cut at Playhead</span>
            <span className="font-mono text-[9px] text-neutral-500">[S]</span>
          </button>

          {/* Amplitude Zoom */}
          <button
            onClick={() => setGainBoost((prev) => (prev >= 2.0 ? 1.0 : prev + 0.5))}
            className="px-2 py-1 rounded bg-white hover:bg-neutral-100 text-neutral-700 hover:text-black text-[11px] font-mono border border-neutral-300 shadow-sm"
            title="Amplify waveform height for quiet recordings"
          >
            {gainBoost}x
          </button>
        </div>
      </div>

      {/* Interactive Segment Waveform Canvas & Ruler */}
      <div
        ref={containerRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        className={`relative bg-white border border-neutral-300 rounded-lg overflow-hidden select-none shadow-sm ${
          cutMode ? 'cursor-crosshair' : 'cursor-pointer'
        }`}
      >
        {/* Relative Time Ruler */}
        <canvas ref={rulerCanvasRef} className="block border-b border-neutral-200" />

        {/* Amplitude Waveform Canvas */}
        <canvas ref={canvasRef} className="block" />

        {/* Left & Right Edge Trim Handles */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setIsDraggingStart(true);
          }}
          className="absolute left-0 top-0 bottom-0 w-3 bg-neutral-300/60 hover:bg-black/60 cursor-ew-resize flex items-center justify-center transition group"
          title="Drag to trim segment start boundary"
        >
          <div className="w-1 h-6 bg-neutral-600 group-hover:bg-white rounded" />
        </div>

        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setIsDraggingEnd(true);
          }}
          className="absolute right-0 top-0 bottom-0 w-3 bg-neutral-300/60 hover:bg-black/60 cursor-ew-resize flex items-center justify-center transition group"
          title="Drag to trim segment end boundary"
        >
          <div className="w-1 h-6 bg-neutral-600 group-hover:bg-white rounded" />
        </div>

        {/* Hover position tooltip badge */}
        {hoverTime !== null && hoverRelTime !== null && (
          <div
            className="absolute top-1 pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-black text-white shadow-md z-20 -translate-x-1/2 whitespace-nowrap"
            style={{
              left: `${Math.max(45, Math.min(canvasWidth - 45, timeToPx(hoverTime)))}px`,
            }}
          >
            {cutMode ? '✂ Cut: ' : 'Seek: '}
            {formatTime(hoverTime)} (+{hoverRelTime.toFixed(2)}s)
          </div>
        )}
      </div>

      {/* Waveform Footer Actions: Next focus preference and time stats */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-neutral-600 px-1 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">After cutting:</span>
          <button
            onClick={() => setSelectSecondAfterCut(false)}
            className={`px-2 py-0.5 rounded transition ${
              !selectSecondAfterCut
                ? 'bg-black text-white font-semibold'
                : 'bg-white text-neutral-700 border border-neutral-200 hover:text-black'
            }`}
            title="Focus the first half to edit transcript"
          >
            Work on Part 1 (Left)
          </button>
          <button
            onClick={() => setSelectSecondAfterCut(true)}
            className={`px-2 py-0.5 rounded transition ${
              selectSecondAfterCut
                ? 'bg-black text-white font-semibold'
                : 'bg-white text-neutral-700 border border-neutral-200 hover:text-black'
            }`}
            title="Focus the new second half to immediately annotate it"
          >
            Work on Part 2 (Right)
          </button>
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] text-neutral-500">
          <span>Start: <strong className="text-neutral-900">{formatTime(segment.startTime)}</strong></span>
          <span>End: <strong className="text-neutral-900">{formatTime(segment.endTime)}</strong></span>
          <span>Duration: <strong className="text-black">{segmentDuration.toFixed(2)}s</strong></span>
        </div>
      </div>
    </div>
  );
};
