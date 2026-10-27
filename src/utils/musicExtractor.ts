/**
 * Music Extraction & Vocal Isolation Engine
 *
 * Utilizes multi-band STFT spectral gating, Middle/Side (M/S) stereo cancellation,
 * harmonic-percussive separation, speech formant envelope tracking, and musical
 * artifact smoothing to isolate human speech and extract background music.
 */

import { AudioSegment } from '../types/audio';

export interface MusicExtractorSettings {
  strength: number; // 0 to 100% (how aggressively to strip music)
  vocalPreservation: number; // 0 to 100% (preserves consonant transients & speech body)
  stereoCancellation: number; // 0 to 100% (cancels panned stereo instruments)
  subBassCut: boolean; // cut sub-bass kick/808/bass < 85 Hz
  highFrequencyCut: boolean; // roll off cymbals/sparkle > 7.5 kHz
  musicFloorDb: number; // -12dB to -45dB (residual floor)
  spectralSmoothing: number; // 0 to 100% (eliminates watery musical noise artifacts)
}

export const DEFAULT_MUSIC_SETTINGS: MusicExtractorSettings = {
  strength: 75,
  vocalPreservation: 85,
  stereoCancellation: 80,
  subBassCut: true,
  highFrequencyCut: true,
  musicFloorDb: -32,
  spectralSmoothing: 60,
};

export const MUSIC_EXTRACTION_PRESETS: {
  name: string;
  description: string;
  settings: MusicExtractorSettings;
}[] = [
  {
    name: 'Podcast Background Music',
    description: 'Balanced extraction for talking voice over ambient background soundtrack music or intro/outro music beds.',
    settings: {
      strength: 75,
      vocalPreservation: 85,
      stereoCancellation: 80,
      subBassCut: true,
      highFrequencyCut: true,
      musicFloorDb: -30,
      spectralSmoothing: 65,
    },
  },
  {
    name: 'Loud Music / Song Vocal Isolation',
    description: 'Aggressive isolation for spoken audio or vocals heavily masked by loud instrumentation or full music mixes.',
    settings: {
      strength: 95,
      vocalPreservation: 80,
      stereoCancellation: 95,
      subBassCut: true,
      highFrequencyCut: true,
      musicFloorDb: -42,
      spectralSmoothing: 75,
    },
  },
  {
    name: 'Acoustic / Piano & Guitar Bed',
    description: 'Tuned for acoustic guitars, piano melodies, and warm string pads without thinning vocal resonance.',
    settings: {
      strength: 65,
      vocalPreservation: 90,
      stereoCancellation: 70,
      subBassCut: true,
      highFrequencyCut: false,
      musicFloorDb: -26,
      spectralSmoothing: 60,
    },
  },
  {
    name: 'Beat & Bassline Removal',
    description: 'Deep suppression of rhythmic drums, 808 sub-bass, kick thumps, and snare transients.',
    settings: {
      strength: 85,
      vocalPreservation: 82,
      stereoCancellation: 85,
      subBassCut: true,
      highFrequencyCut: true,
      musicFloorDb: -36,
      spectralSmoothing: 70,
    },
  },
  {
    name: 'Gentle Voice Polish',
    description: 'Conservative reduction that preserves 100% of whispery breaths and subtle vocal dynamics.',
    settings: {
      strength: 45,
      vocalPreservation: 95,
      stereoCancellation: 50,
      subBassCut: true,
      highFrequencyCut: false,
      musicFloorDb: -20,
      spectralSmoothing: 50,
    },
  },
];

/**
 * Radix-2 Fast Fourier Transform
 */
class Radix2FFT {
  private n: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private bitReverse: Uint16Array;

  constructor(n: number) {
    this.n = n;
    const half = n / 2;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / n);
    }

    this.bitReverse = new Uint16Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitReverse[i] = rev;
    }
  }

  public transform(real: Float32Array, imag: Float32Array, inverse = false): void {
    const n = this.n;

    for (let i = 0; i < n; i++) {
      const j = this.bitReverse[i];
      if (i < j) {
        const tr = real[i];
        real[i] = real[j];
        real[j] = tr;
        const ti = imag[i];
        imag[i] = imag[j];
        imag[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const k = j * step;
          const cos = this.cosTable[k];
          const sin = inverse ? -this.sinTable[k] : this.sinTable[k];

          const uR = real[i + j];
          const uI = imag[i + j];
          const vR = real[i + j + halfLen] * cos - imag[i + j + halfLen] * sin;
          const vI = real[i + j + halfLen] * sin + imag[i + j + halfLen] * cos;

          real[i + j] = uR + vR;
          imag[i + j] = uI + vI;
          real[i + j + halfLen] = uR - vR;
          imag[i + j + halfLen] = uI - vI;
        }
      }
    }

    if (inverse) {
      const invN = 1.0 / n;
      for (let i = 0; i < n; i++) {
        real[i] *= invN;
        imag[i] *= invN;
      }
    }
  }
}

/**
 * 2nd-order Butterworth IIR filters for audio conditioning
 */
class BiquadFilter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  public setHighPass(cutoffFreq: number, sampleRate: number, q = 0.707): void {
    const w0 = (2 * Math.PI * cutoffFreq) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);

    const a0 = 1 + alpha;
    this.b0 = (1 + cosw0) / 2 / a0;
    this.b1 = -(1 + cosw0) / a0;
    this.b2 = (1 + cosw0) / 2 / a0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  public setLowPass(cutoffFreq: number, sampleRate: number, q = 0.707): void {
    const w0 = (2 * Math.PI * cutoffFreq) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);

    const a0 = 1 + alpha;
    this.b0 = (1 - cosw0) / 2 / a0;
    this.b1 = (1 - cosw0) / a0;
    this.b2 = (1 - cosw0) / 2 / a0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  public process(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 =
        this.b0 * x0 +
        this.b1 * this.x1 +
        this.b2 * this.x2 -
        this.a1 * this.y1 -
        this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x0;
      this.y2 = this.y1;
      this.y1 = y0;
      output[i] = y0;
    }
    return output;
  }
}

/**
 * Core DSP Music Extraction & Vocal Isolation on 1 or 2 channels.
 * Returns both the separated Vocal channels (clean voice) and Music channels (isolated accompaniment).
 */
export function extractMusicFromChannelData(
  channelData: Float32Array[],
  sampleRate: number,
  settings: MusicExtractorSettings
): { vocalChannels: Float32Array[]; musicChannels: Float32Array[] } {
  const numChannels = channelData.length;
  const numSamples = channelData[0].length;
  if (numSamples < 512) {
    return {
      vocalChannels: channelData.map((c) => new Float32Array(c)),
      musicChannels: channelData.map(() => new Float32Array(numSamples)),
    };
  }

  const isStereo = numChannels >= 2;
  const fftSize = 2048;
  const hopSize = 512;
  const fft = new Radix2FFT(fftSize);
  const numBins = fftSize / 2 + 1;

  // Analysis / synthesis Hanning window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  // Pre-calculate bin frequencies
  const binFreqs = new Float32Array(numBins);
  for (let b = 0; b < numBins; b++) {
    binFreqs[b] = (b * sampleRate) / fftSize;
  }

  // Frequency range indices
  const vocalMinBin = Math.max(1, Math.floor((100 * fftSize) / sampleRate));
  const vocalCoreMaxBin = Math.min(numBins - 1, Math.floor((3600 * fftSize) / sampleRate));
  const sibilanceMaxBin = Math.min(numBins - 1, Math.floor((7200 * fftSize) / sampleRate));

  // Compute Mid (mono center) and Side (stereo stereo-spread) if stereo
  let leftInput = channelData[0];
  let rightInput = isStereo ? channelData[1] : channelData[0];

  const mid = new Float32Array(numSamples);
  const side = isStereo ? new Float32Array(numSamples) : null;

  if (isStereo) {
    for (let i = 0; i < numSamples; i++) {
      mid[i] = 0.5 * (leftInput[i] + rightInput[i]);
      side![i] = 0.5 * (leftInput[i] - rightInput[i]);
    }
  } else {
    mid.set(leftInput);
  }

  const numFrames = Math.max(1, Math.floor((numSamples - fftSize) / hopSize) + 1);

  // Spectral magnitude arrays
  const midMags = new Float32Array(numFrames * numBins);
  const midPhases = new Float32Array(numFrames * numBins);
  const sideMags = isStereo ? new Float32Array(numFrames * numBins) : null;

  const realBuffer = new Float32Array(fftSize);
  const imagBuffer = new Float32Array(fftSize);

  // 1. Forward STFT analysis
  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    const frameBase = f * numBins;

    // Mid channel STFT
    for (let i = 0; i < fftSize; i++) {
      realBuffer[i] = mid[offset + i] * window[i];
      imagBuffer[i] = 0;
    }
    fft.transform(realBuffer, imagBuffer, false);

    for (let b = 0; b < numBins; b++) {
      const r = realBuffer[b];
      const im = imagBuffer[b];
      midMags[frameBase + b] = Math.sqrt(r * r + im * im);
      midPhases[frameBase + b] = Math.atan2(im, r);
    }

    // Side channel STFT (if stereo)
    if (isStereo && side) {
      for (let i = 0; i < fftSize; i++) {
        realBuffer[i] = side[offset + i] * window[i];
        imagBuffer[i] = 0;
      }
      fft.transform(realBuffer, imagBuffer, false);
      for (let b = 0; b < numBins; b++) {
        const r = realBuffer[b];
        const im = imagBuffer[b];
        sideMags![frameBase + b] = Math.sqrt(r * r + im * im);
      }
    }
  }

  // 2. Compute background musical profile and stationarity
  // Background music tends to have steady energy and sustained chords across consecutive frames,
  // whereas spoken voice fluctuates rapidly with phoneme transitions and syllable pauses.
  const musicFloorEst = new Float32Array(numBins);
  for (let b = 0; b < numBins; b++) {
    // Estimate baseline energy across frames using lower 20th percentile
    const binVals: number[] = [];
    const step = Math.max(1, Math.floor(numFrames / 40));
    for (let f = 0; f < numFrames; f += step) {
      binVals.push(midMags[f * numBins + b]);
    }
    binVals.sort((a, b) => a - b);
    const p20Idx = Math.floor(binVals.length * 0.22);
    musicFloorEst[b] = binVals[p20Idx] || 1e-5;
  }

  // Calculate vocal soft mask matrix (numFrames x numBins)
  const vocalMask = new Float32Array(numFrames * numBins);

  const strengthNorm = Math.max(0.1, Math.min(1.0, settings.strength / 100));
  const vocalPreserveNorm = Math.max(0.1, Math.min(1.0, settings.vocalPreservation / 100));
  const stereoCancelNorm = isStereo ? Math.max(0, Math.min(1.0, settings.stereoCancellation / 100)) : 0;
  const minFloor = Math.pow(10, (settings.musicFloorDb || -32) / 20);

  // Moving variance tracker across 5 frames for harmonic stationarity
  for (let f = 0; f < numFrames; f++) {
    const frameBase = f * numBins;
    const prevBase = Math.max(0, f - 1) * numBins;
    const nextBase = Math.min(numFrames - 1, f + 1) * numBins;

    // Estimate total speech energy in vocal formant region for this frame
    let formantEnergy = 0;
    for (let b = vocalMinBin; b <= vocalCoreMaxBin; b++) {
      formantEnergy += midMags[frameBase + b];
    }
    const avgFormantMag = formantEnergy / (vocalCoreMaxBin - vocalMinBin + 1);

    for (let b = 0; b < numBins; b++) {
      const mag = midMags[frameBase + b];
      const prevMag = midMags[prevBase + b];
      const nextMag = midMags[nextBase + b];
      const baseline = musicFloorEst[b];

      // 1. Amplitude above background floor
      const snr = mag / (baseline + 1e-6);

      // 2. Harmonic stationarity (music chords/notes sustain steadily across time)
      const diff1 = Math.abs(mag - prevMag);
      const diff2 = Math.abs(nextMag - mag);
      const flux = (diff1 + diff2) / (mag + 1e-6); // high flux = dynamic speech / consonants, low flux = sustained musical tone

      // 3. Vocal formant frequency weighting
      let freqVocalAffinity = 0.35;
      if (b >= vocalMinBin && b <= vocalCoreMaxBin) {
        freqVocalAffinity = 1.0;
      } else if (b > vocalCoreMaxBin && b <= sibilanceMaxBin) {
        freqVocalAffinity = 0.75 * vocalPreserveNorm;
      } else if (b < vocalMinBin) {
        freqVocalAffinity = 0.1; // sub-bass is virtually all music/kick/bass
      } else {
        freqVocalAffinity = 0.2; // ultra-high sparkle
      }

      // 4. Stereo cancellation factor (if stereo):
      // Center vocals have low side-to-mid ratio. Widely panned guitars/keys/reverbs have high side-to-mid ratio.
      let stereoVocalScore = 1.0;
      if (isStereo && sideMags) {
        const sideMag = sideMags[frameBase + b];
        const sideToMid = sideMag / (mag + 1e-6);
        // If side energy is strong relative to mid, it's definitely stereo musical accompaniment
        stereoVocalScore = Math.max(0.02, 1.0 - Math.min(1.0, sideToMid * 1.5 * stereoCancelNorm));
      }

      // Combine factors into a vocal probability score (0 to 1)
      let vocalScore = 0.0;
      if (snr > 1.25) {
        const snrWeight = Math.min(1.0, (snr - 1.0) / 4.0);
        const dynamicWeight = Math.min(1.0, flux * 1.2 + 0.2);
        vocalScore = snrWeight * 0.45 + dynamicWeight * 0.25 + freqVocalAffinity * 0.3;
      } else {
        vocalScore = 0.1 * freqVocalAffinity;
      }

      // Apply stereo penalty
      vocalScore *= stereoVocalScore;

      // Soft masking curve scaled by user strength and vocal preservation
      const maskPower = 1.2 + strengthNorm * 1.8;
      let mask = Math.pow(Math.max(0, Math.min(1.0, vocalScore)), maskPower);

      // Protect strong vocal consonants and vowels
      if (mag > avgFormantMag * 0.8 && b >= vocalMinBin && b <= sibilanceMaxBin) {
        mask = Math.max(mask, 0.4 * vocalPreserveNorm);
      }

      // Enforce residual noise floor
      mask = Math.max(minFloor, Math.min(1.0, mask));

      vocalMask[frameBase + b] = mask;
    }
  }

  // 3. Spectral Smoothing across frequency bins and time to suppress "musical noise" (chirping)
  const smoothingFactor = Math.max(0, Math.min(1.0, settings.spectralSmoothing / 100)) * 0.65;
  if (smoothingFactor > 0.05) {
    for (let f = 0; f < numFrames; f++) {
      const frameBase = f * numBins;
      // Frequency smoothing
      for (let b = 1; b < numBins - 1; b++) {
        const prev = vocalMask[frameBase + b - 1];
        const curr = vocalMask[frameBase + b];
        const next = vocalMask[frameBase + b + 1];
        vocalMask[frameBase + b] = curr * (1 - smoothingFactor) + (prev + next) * 0.5 * smoothingFactor;
      }
    }
  }

  // 4. Inverse STFT synthesis via Overlap-Add (OLA) for both Vocal and Music stems
  const vocalOutMid = new Float32Array(numSamples);
  const musicOutMid = new Float32Array(numSamples);
  const olaWindowSum = new Float32Array(numSamples);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    const frameBase = f * numBins;

    // Synthesize Vocal frame
    for (let b = 0; b < numBins; b++) {
      const phase = midPhases[frameBase + b];
      const vMag = midMags[frameBase + b] * vocalMask[frameBase + b];
      realBuffer[b] = vMag * Math.cos(phase);
      imagBuffer[b] = vMag * Math.sin(phase);
    }
    // Conjugate symmetric upper half
    for (let b = numBins; b < fftSize; b++) {
      realBuffer[b] = realBuffer[fftSize - b];
      imagBuffer[b] = -imagBuffer[fftSize - b];
    }
    fft.transform(realBuffer, imagBuffer, true);
    for (let i = 0; i < fftSize && offset + i < numSamples; i++) {
      vocalOutMid[offset + i] += realBuffer[i] * window[i];
    }

    // Synthesize Music frame (complementary magnitude)
    for (let b = 0; b < numBins; b++) {
      const phase = midPhases[frameBase + b];
      const mMag = midMags[frameBase + b] * (1.0 - vocalMask[frameBase + b]);
      realBuffer[b] = mMag * Math.cos(phase);
      imagBuffer[b] = mMag * Math.sin(phase);
    }
    for (let b = numBins; b < fftSize; b++) {
      realBuffer[b] = realBuffer[fftSize - b];
      imagBuffer[b] = -imagBuffer[fftSize - b];
    }
    fft.transform(realBuffer, imagBuffer, true);
    for (let i = 0; i < fftSize && offset + i < numSamples; i++) {
      musicOutMid[offset + i] += realBuffer[i] * window[i];
      olaWindowSum[offset + i] += window[i] * window[i];
    }
  }

  // Normalize by OLA window sum
  for (let i = 0; i < numSamples; i++) {
    const wSum = olaWindowSum[i];
    if (wSum > 1e-4) {
      vocalOutMid[i] /= wSum;
      musicOutMid[i] /= wSum;
    }
  }

  // 5. Post-filtering: Sub-bass highpass (85 Hz) & high-frequency lowpass (7500 Hz) on Vocal Stem
  let filteredVocal: Float32Array = vocalOutMid;
  if (settings.subBassCut) {
    const hp = new BiquadFilter();
    hp.setHighPass(85, sampleRate, 0.707);
    filteredVocal = hp.process(filteredVocal);
  }
  if (settings.highFrequencyCut) {
    const lp = new BiquadFilter();
    lp.setLowPass(7600, sampleRate, 0.707);
    filteredVocal = lp.process(filteredVocal);
  }

  // Format outputs for multi-channel
  const vocalChannels: Float32Array[] = [];
  const musicChannels: Float32Array[] = [];

  if (isStereo) {
    // For vocal, the voice is cleanly centered
    vocalChannels.push(filteredVocal);
    vocalChannels.push(new Float32Array(filteredVocal));

    // For music, add back the stereo side instrumentation plus extracted center music
    const musicL = new Float32Array(numSamples);
    const musicR = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      musicL[i] = musicOutMid[i] + (side ? side[i] : 0);
      musicR[i] = musicOutMid[i] - (side ? side[i] : 0);
    }
    musicChannels.push(musicL);
    musicChannels.push(musicR);
  } else {
    vocalChannels.push(filteredVocal);
    musicChannels.push(musicOutMid);
  }

  return { vocalChannels, musicChannels };
}

/**
 * Creates AudioBuffer from Float32 channel arrays
 */
function createAudioBufferFromChannels(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let c = 0; c < channels.length; c++) {
    buffer.getChannelData(c).set(channels[c]);
  }
  ctx.close().catch(() => {});
  return buffer;
}

/**
 * Extracts music from an entire AudioBuffer, returning both vocalBuffer and musicBuffer.
 */
export async function extractMusicFromAudioBuffer(
  audioBuffer: AudioBuffer,
  settings: MusicExtractorSettings
): Promise<{ vocalBuffer: AudioBuffer; musicBuffer: AudioBuffer }> {
  const numChannels = audioBuffer.numberOfChannels;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(new Float32Array(audioBuffer.getChannelData(c)));
  }

  const { vocalChannels, musicChannels } = extractMusicFromChannelData(
    channelData,
    audioBuffer.sampleRate,
    settings
  );

  const vocalBuffer = createAudioBufferFromChannels(vocalChannels, audioBuffer.sampleRate);
  const musicBuffer = createAudioBufferFromChannels(musicChannels, audioBuffer.sampleRate);

  return { vocalBuffer, musicBuffer };
}

/**
 * Creates quick real-time preview slices for A/B/C testing:
 * - originalSlice: uncleaned mix with music
 * - vocalSlice: isolated human speech (music stripped)
 * - musicSlice: extracted background music
 */
export async function createMusicExtractionPreview(
  audioBuffer: AudioBuffer,
  startTime: number,
  duration: number,
  settings: MusicExtractorSettings
): Promise<{
  originalSlice: AudioBuffer;
  vocalSlice: AudioBuffer;
  musicSlice: AudioBuffer;
}> {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const sliceSamples = Math.min(
    Math.floor(duration * sampleRate),
    audioBuffer.length - startSample
  );

  const numChannels = audioBuffer.numberOfChannels;
  const origChannels: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const raw = audioBuffer.getChannelData(c);
    const slice = new Float32Array(sliceSamples);
    slice.set(raw.subarray(startSample, startSample + sliceSamples));
    origChannels.push(slice);
  }

  const { vocalChannels, musicChannels } = extractMusicFromChannelData(
    origChannels,
    sampleRate,
    settings
  );

  const originalSlice = createAudioBufferFromChannels(origChannels, sampleRate);
  const vocalSlice = createAudioBufferFromChannels(vocalChannels, sampleRate);
  const musicSlice = createAudioBufferFromChannels(musicChannels, sampleRate);

  return { originalSlice, vocalSlice, musicSlice };
}

/**
 * Batch music extraction across a list of selected segments within an AudioBuffer.
 * Only modifies audio in the selected segment boundaries with smooth 10ms micro cross-fades.
 */
export async function batchExtractMusicSegments(
  audioBuffer: AudioBuffer,
  segmentsToProcess: AudioSegment[],
  settings: MusicExtractorSettings,
  onProgress?: (progressPct: number, currentSegmentId: string, currentIdx: number, total: number) => void
): Promise<AudioBuffer> {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;

  // Clone full channel data
  const outputChannels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    outputChannels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }

  const crossFadeSamples = Math.floor(sampleRate * 0.01); // 10ms cross-fade

  for (let i = 0; i < segmentsToProcess.length; i++) {
    const seg = segmentsToProcess[i];
    const segStart = Math.max(0, Math.floor(seg.startTime * sampleRate));
    const segEnd = Math.min(audioBuffer.length, Math.floor(seg.endTime * sampleRate));
    const segLength = segEnd - segStart;

    if (segLength > 256) {
      // Extract segment channels
      const segChannels: Float32Array[] = [];
      for (let c = 0; c < numChannels; c++) {
        const segData = new Float32Array(segLength);
        segData.set(outputChannels[c].subarray(segStart, segEnd));
        segChannels.push(segData);
      }

      // Process segment
      const { vocalChannels } = extractMusicFromChannelData(segChannels, sampleRate, settings);

      // Splice back with smooth crossfade boundaries
      for (let c = 0; c < numChannels; c++) {
        const outData = outputChannels[c];
        const cleanData = vocalChannels[c] || vocalChannels[0];

        // Splicing
        for (let j = 0; j < segLength; j++) {
          const targetIdx = segStart + j;
          let weight = 1.0;
          if (j < crossFadeSamples) {
            weight = j / crossFadeSamples;
          } else if (j > segLength - crossFadeSamples) {
            weight = (segLength - j) / crossFadeSamples;
          }
          outData[targetIdx] = outData[targetIdx] * (1.0 - weight) + cleanData[j] * weight;
        }
      }
    }

    if (onProgress) {
      const pct = Math.round(((i + 1) / segmentsToProcess.length) * 100);
      onProgress(pct, seg.id, i + 1, segmentsToProcess.length);
      // Yield to UI event loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return createAudioBufferFromChannels(outputChannels, sampleRate);
}
