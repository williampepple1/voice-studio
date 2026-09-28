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

    // Gain node
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    source.connect(gain);

    // Analyser node for real-time RMS amplitude & peak monitoring
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.sourceNode = source;
    this.gainNode = gain;
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

    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    source.connect(gain);

    // Analyser node for real-time RMS amplitude & peak monitoring
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.sourceNode = source;
    this.gainNode = gain;
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
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
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
