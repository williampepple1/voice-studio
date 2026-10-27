/**
 * Web Audio Engine for Real-Time Precision Playback, Scrubbing, and Seamless Segment Looping
 */

export type PlaybackListener = (currentTime: number, isPlaying: boolean) => void;

export interface AudioLevels {
  rms: number; // 0.0 to 1.0 linear
  rmsDb: number; // e.g. -60 to 0 dB
  peak: number; // 0.0 to 1.0 linear
  peakDb: number; // e.g. -60 to 0 dB
  isClipping: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private isPlaying = false;
  private isLooping = false;
  private startTimeOffset = 0;
  private playbackStartedAtAudioContextTime = 0;
  private playbackRate = 1.0;
  private volume = 1.0;
  private autoGainEnabled = false;
  private currentAutoGainMultiplier = 1.0;
  private compressorNode: DynamicsCompressorNode | null = null;
  private segmentsList: { id: string; startTime: number; endTime: number }[] = [];
  private lastDetectedSegmentId: string | null = null;

  private loopRegion: { start: number; end: number } | null = null;
  private animationFrameId: number | null = null;
  private listeners: Set<PlaybackListener> = new Set();

  constructor() {
    // Lazy AudioContext initialization on first user interaction
  }

  public getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setBuffer(buffer: AudioBuffer) {
    this.stop();
    this.currentBuffer = buffer;
    this.startTimeOffset = 0;
    this.loopRegion = null;
    this.notifyListeners(0, false);
  }

  public getBuffer(): AudioBuffer | null {
    return this.currentBuffer;
  }

  public subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(time: number, playing: boolean) {
    for (const listener of this.listeners) {
      listener(time, playing);
    }
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.startTimeOffset;
    }
    const elapsed = (this.ctx.currentTime - this.playbackStartedAtAudioContextTime) * this.playbackRate;
    let current = this.startTimeOffset + elapsed;

    if (this.loopRegion && this.isLooping) {
      const loopDuration = Math.max(0.05, this.loopRegion.end - this.loopRegion.start);
      if (current >= this.loopRegion.end) {
        // Wrapped in loop
        const loopOffset = (current - this.loopRegion.start) % loopDuration;
        current = this.loopRegion.start + loopOffset;
      }
    } else if (this.currentBuffer && current >= this.currentBuffer.duration) {
      current = this.currentBuffer.duration;
    }

    return current;
  }

  public play(fromTime?: number) {
    if (!this.currentBuffer) return;
    const ctx = this.getContext();

    this.stopPlaybackNodesOnly();

    const startPos = fromTime !== undefined ? fromTime : this.startTimeOffset;
    this.startTimeOffset = Math.max(0, Math.min(startPos, this.currentBuffer.duration));

    const source = ctx.createBufferSource();
    source.buffer = this.currentBuffer;
    source.playbackRate.value = this.playbackRate;

    // Check if playback starts inside a known segment to calibrate initial auto-gain
    if (this.autoGainEnabled) {
      const curSeg = this.segmentsList.find(s => this.startTimeOffset >= s.startTime && this.startTimeOffset <= s.endTime);
      if (curSeg) {
        this.currentAutoGainMultiplier = this.calculateSegmentAutoGain(curSeg.startTime, curSeg.endTime);
      } else {
        this.currentAutoGainMultiplier = 1.0;
      }
    } else {
      this.currentAutoGainMultiplier = 1.0;
    }

    // Gain node
    const gain = ctx.createGain();
    this.updateEffectiveGain(gain, false);
    source.connect(gain);

    // Dynamics compressor for transparent leveling and clipping prevention
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 8;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    // Analyser node for real-time RMS amplitude & peak monitoring
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;

    if (this.autoGainEnabled) {
      gain.connect(compressor);
      compressor.connect(analyser);
    } else {
      gain.connect(analyser);
    }
    analyser.connect(ctx.destination);

    this.sourceNode = source;
    this.gainNode = gain;
    this.compressorNode = compressor;
    this.analyserNode = analyser;

    this.playbackStartedAtAudioContextTime = ctx.currentTime;
    this.isPlaying = true;

    // Handle normal full audio playback
    source.start(0, this.startTimeOffset);

    source.onended = () => {
      if (this.isPlaying && !this.isLooping) {
        this.stop();
      }
    };

    this.startTracking();
    this.notifyListeners(this.startTimeOffset, true);
  }

  /**
   * Play a specific segment, optionally with seamless loop
   */
  public playSegment(start: number, end: number, loop = false) {
    if (!this.currentBuffer) return;
    const ctx = this.getContext();

    this.stopPlaybackNodesOnly();

    const validStart = Math.max(0, start);
    const validEnd = Math.min(this.currentBuffer.duration, end);
    const duration = Math.max(0.05, validEnd - validStart);

    this.loopRegion = { start: validStart, end: validEnd };
    this.isLooping = loop;
    this.startTimeOffset = validStart;

    const source = ctx.createBufferSource();
    source.buffer = this.currentBuffer;
    source.playbackRate.value = this.playbackRate;

    if (loop) {
      source.loop = true;
      source.loopStart = validStart;
      source.loopEnd = validEnd;
    }

    // Auto-Gain: calculate optimal normalizer gain for this specific segment
    if (this.autoGainEnabled) {
      this.currentAutoGainMultiplier = this.calculateSegmentAutoGain(validStart, validEnd);
    } else {
      this.currentAutoGainMultiplier = 1.0;
    }

    const gain = ctx.createGain();
    this.updateEffectiveGain(gain, false);
    source.connect(gain);

    // Dynamics compressor for transparent leveling and clipping prevention
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 8;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    // Analyser node for real-time RMS amplitude & peak monitoring
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;

    if (this.autoGainEnabled) {
      gain.connect(compressor);
      compressor.connect(analyser);
    } else {
      gain.connect(analyser);
    }
    analyser.connect(ctx.destination);

    this.sourceNode = source;
    this.gainNode = gain;
    this.compressorNode = compressor;
    this.analyserNode = analyser;

    this.playbackStartedAtAudioContextTime = ctx.currentTime;
    this.isPlaying = true;

    if (loop) {
      source.start(0, validStart);
    } else {
      source.start(0, validStart, duration);
      source.onended = () => {
        if (this.isPlaying && !this.isLooping) {
          this.stop();
          this.seekTo(validStart);
        }
      };
    }

    this.startTracking();
    this.notifyListeners(validStart, true);
  }

  public setLooping(enabled: boolean) {
    this.isLooping = enabled;
    if (this.sourceNode && this.loopRegion) {
      this.sourceNode.loop = enabled;
      if (enabled) {
        this.sourceNode.loopStart = this.loopRegion.start;
        this.sourceNode.loopEnd = this.loopRegion.end;
      }
    }
  }

  public isCurrentlyLooping(): boolean {
    return this.isLooping;
  }

  public pause() {
    if (!this.isPlaying) return;
    const current = this.getCurrentTime();
    this.stopPlaybackNodesOnly();
    this.startTimeOffset = current;
    this.isPlaying = false;
    this.notifyListeners(current, false);
  }

  public stop() {
    this.stopPlaybackNodesOnly();
    this.isPlaying = false;
    this.isLooping = false;
    this.notifyListeners(this.startTimeOffset, false);
  }

  public seekTo(timeSec: number) {
    const clamped = Math.max(0, Math.min(timeSec, this.currentBuffer ? this.currentBuffer.duration : 0));
    const wasPlaying = this.isPlaying;
    const wasLooping = this.isLooping;
    const region = this.loopRegion;

    this.stopPlaybackNodesOnly();
    this.startTimeOffset = clamped;

    if (wasPlaying) {
      if (wasLooping && region && clamped >= region.start && clamped <= region.end) {
        this.playSegment(region.start, region.end, true);
      } else {
        this.play(clamped);
      }
    } else {
      this.notifyListeners(clamped, false);
    }
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(0.25, Math.min(2.0, rate));
    if (this.sourceNode) {
      this.sourceNode.playbackRate.value = this.playbackRate;
    }
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.updateEffectiveGain(undefined, true);
  }

  public setAutoGain(enabled: boolean) {
    this.autoGainEnabled = enabled;
    if (this.isPlaying && this.currentBuffer) {
      const cur = this.getCurrentTime();
      const seg = this.segmentsList.find(s => cur >= s.startTime && cur <= s.endTime);
      if (seg) {
        this.currentAutoGainMultiplier = this.calculateSegmentAutoGain(seg.startTime, seg.endTime);
      } else {
        this.currentAutoGainMultiplier = 1.0;
      }
      this.updateEffectiveGain(undefined, true);
    }
  }

  public isAutoGainEnabled(): boolean {
    return this.autoGainEnabled;
  }

  public setSegments(segments: { id: string; startTime: number; endTime: number }[]) {
    this.segmentsList = segments;
  }

  public getAutoGainMultiplier(): number {
    return this.autoGainEnabled ? this.currentAutoGainMultiplier : 1.0;
  }

  public getAutoGainDb(): number {
    if (!this.autoGainEnabled || Math.abs(this.currentAutoGainMultiplier - 1.0) < 0.05) return 0;
    return Math.round(20 * Math.log10(this.currentAutoGainMultiplier) * 10) / 10;
  }

  public calculateSegmentAutoGain(startSec: number, endSec: number): number {
    if (!this.currentBuffer) return 1.0;
    const sampleRate = this.currentBuffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(this.currentBuffer.length, Math.ceil(endSec * sampleRate));
    const totalSamples = endSample - startSample;
    if (totalSamples < 100) return 1.0;

    const step = Math.max(1, Math.floor(totalSamples / 1200));
    let sumSquares = 0;
    let peak = 0;
    let count = 0;

    const numChannels = this.currentBuffer.numberOfChannels;
    for (let c = 0; c < numChannels; c++) {
      const data = this.currentBuffer.getChannelData(c);
      for (let i = startSample; i < endSample; i += step) {
        const val = data[i];
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
        sumSquares += val * val;
        count++;
      }
    }

    if (count === 0 || peak < 0.005) {
      return 1.0;
    }

    const rms = Math.sqrt(sumSquares / count);
    const targetRms = 0.125; // ~ -18 dB standard speech target RMS
    const targetPeakCeiling = 0.84; // ~ -1.5 dB peak ceiling

    let desiredGain = targetRms / Math.max(0.02, rms);
    if (peak * desiredGain > targetPeakCeiling) {
      desiredGain = targetPeakCeiling / peak;
    }

    // Clamp boost/cut between 0.35x (-9dB) and 3.5x (+11dB)
    return Math.min(3.5, Math.max(0.35, desiredGain));
  }

  private updateEffectiveGain(targetNode?: GainNode, smooth = true) {
    const g = targetNode || this.gainNode;
    if (!g || !this.ctx) return;
    const targetGain = this.volume * (this.autoGainEnabled ? this.currentAutoGainMultiplier : 1.0);
    if (smooth && this.isPlaying) {
      try {
        g.gain.cancelScheduledValues(this.ctx.currentTime);
        g.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.04);
      } catch (_) {
        g.gain.value = targetGain;
      }
    } else {
      g.gain.value = targetGain;
    }
  }

  private stopPlaybackNodesOnly() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // already stopped
      }
      this.sourceNode = null;
    }
    if (this.compressorNode) {
      try {
        this.compressorNode.disconnect();
      } catch {
        // already disconnected
      }
      this.compressorNode = null;
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // already disconnected
      }
      this.analyserNode = null;
    }
  }

  /**
   * Returns current real-time audio loudness levels (RMS, Peak, Decibels, Clipping)
   */
  public getAudioLevels(): AudioLevels {
    if (!this.isPlaying || !this.analyserNode) {
      return {
        rms: 0,
        rmsDb: -90,
        peak: 0,
        peakDb: -90,
        isClipping: false,
      };
    }

    const data = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(data);

    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const abs = Math.abs(val);
      if (abs > peak) peak = abs;
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / data.length);
    const rmsDb = rms > 1e-4 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
    const peakDb = peak > 1e-4 ? Math.max(-90, 20 * Math.log10(peak)) : -90;
    const isClipping = peak >= 0.985;

    return {
      rms,
      rmsDb: Math.round(rmsDb * 10) / 10,
      peak,
      peakDb: Math.round(peakDb * 10) / 10,
      isClipping,
    };
  }

  private startTracking() {
    const loop = () => {
      if (!this.isPlaying) return;
      const current = this.getCurrentTime();
      this.notifyListeners(current, true);

      // Dynamic Auto-Gain adjustment when crossing segment boundaries
      if (this.autoGainEnabled && this.segmentsList.length > 0) {
        const curSeg = this.segmentsList.find(s => current >= s.startTime && current <= s.endTime);
        const curSegId = curSeg ? curSeg.id : null;
        if (curSegId !== this.lastDetectedSegmentId) {
          this.lastDetectedSegmentId = curSegId;
          if (curSeg) {
            this.currentAutoGainMultiplier = this.calculateSegmentAutoGain(curSeg.startTime, curSeg.endTime);
          } else {
            this.currentAutoGainMultiplier = 1.0;
          }
          this.updateEffectiveGain(undefined, true);
        }
      }

      // Check non-looping end
      if (!this.isLooping && this.currentBuffer && current >= this.currentBuffer.duration) {
        this.stop();
        return;
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  public destroy() {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.listeners.clear();
  }
}

// Global singleton instance for easy React hook consumption
export const globalAudioEngine = new AudioEngine();
