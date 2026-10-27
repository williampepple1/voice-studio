/**
 * Acoustic De-Reverberation & Room Acoustic Cleaner
 * Uses multi-band spectral decay subtraction, transient preservation,
 * and parametric room resonance filtering to remove room reflections and echo from speech.
 */

export interface DeReverbSettings {
  strength: number; // 0 to 100%
  decayTimeMs: number; // 100 to 1200 ms (estimated room RT60)
  transientPreservation: number; // 0 to 100%
  roomBoxinessNotch: boolean; // notch filter at room resonance
  boxinessFreqHz: number; // 180 to 400 Hz
  highPassDeRumble: boolean; // 75 Hz high-pass
  dryWetMix: number; // 0 to 100% (100% = fully processed dry audio)
}

export const DEFAULT_DEREVERB_SETTINGS: DeReverbSettings = {
  strength: 70,
  decayTimeMs: 400,
  transientPreservation: 80,
  roomBoxinessNotch: true,
  boxinessFreqHz: 240,
  highPassDeRumble: true,
  dryWetMix: 100,
};

export const DEREVERB_PRESETS: { name: string; description: string; settings: DeReverbSettings }[] = [
  {
    name: 'Bedroom / Untreated Room',
    description: 'Tames boxy wall reflections and standing waves from standard home recording setups.',
    settings: {
      strength: 65,
      decayTimeMs: 380,
      transientPreservation: 85,
      roomBoxinessNotch: true,
      boxinessFreqHz: 230,
      highPassDeRumble: true,
      dryWetMix: 100,
    },
  },
  {
    name: 'Hollow Echo / Tile Room',
    description: 'Suppresses long diffuse reverberation tails and flutter reflections.',
    settings: {
      strength: 85,
      decayTimeMs: 650,
      transientPreservation: 80,
      roomBoxinessNotch: true,
      boxinessFreqHz: 280,
      highPassDeRumble: true,
      dryWetMix: 100,
    },
  },
  {
    name: 'Subtle Mic Tame',
    description: 'Gentle reflection reduction that preserves full natural vocal warmth.',
    settings: {
      strength: 40,
      decayTimeMs: 220,
      transientPreservation: 90,
      roomBoxinessNotch: false,
      boxinessFreqHz: 240,
      highPassDeRumble: true,
      dryWetMix: 100,
    },
  },
  {
    name: 'Studio Dry (TTS Training)',
    description: 'Maximum dry extraction to isolate clean vocal phonemes for speech synthesis models.',
    settings: {
      strength: 95,
      decayTimeMs: 480,
      transientPreservation: 92,
      roomBoxinessNotch: true,
      boxinessFreqHz: 240,
      highPassDeRumble: true,
      dryWetMix: 100,
    },
  },
];

/**
 * Radix-2 FFT / IFFT for spectral processing
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

    // Bit reversal permutation
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

    // Cooley-Tukey butterfly stages
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const k = j * step;
          let c = this.cosTable[k];
          let s = this.sinTable[k];
          if (inverse) {
            s = -s;
          }

          const tr = real[i + j + halfLen] * c - imag[i + j + halfLen] * s;
          const ti = real[i + j + halfLen] * s + imag[i + j + halfLen] * c;

          real[i + j + halfLen] = real[i + j] - tr;
          imag[i + j + halfLen] = imag[i + j] - ti;
          real[i + j] += tr;
          imag[i + j] += ti;
        }
      }
    }

    if (inverse) {
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        real[i] *= invN;
        imag[i] *= invN;
      }
    }
  }
}

/**
 * Bi-quad filter difference equations (Highpass and Peaking Notch)
 */
function applyBiquadFilter(
  channel: Float32Array,
  sampleRate: number,
  type: 'highpass' | 'notch',
  freq: number,
  q = 1.0,
  gainDb = -6.0
): Float32Array {
  const output = new Float32Array(channel.length);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  if (type === 'highpass') {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === 'notch') {
    // Peaking notch attenuation
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cosW0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosW0;
    a2 = 1 - alpha / A;
  }

  // Normalize coefficients
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < channel.length; i++) {
    const x0 = channel[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    output[i] = y0;
  }

  return output;
}

/**
 * Processes a single mono channel Float32Array to suppress room reverberation.
 */
export function deReverbChannel(
  input: Float32Array,
  sampleRate: number,
  settings: DeReverbSettings
): Float32Array {
  const fftSize = 512;
  const hopSize = 128; // 75% overlap for artifact-free phase reconstruction
  const numBins = fftSize / 2 + 1;
  const fft = new Radix2FFT(fftSize);

  // Pre-filter room boxiness and sub-bass rumble if enabled
  let workingSignal = input;
  if (settings.highPassDeRumble) {
    workingSignal = applyBiquadFilter(workingSignal, sampleRate, 'highpass', 75, 0.707);
  }
  if (settings.roomBoxinessNotch && settings.boxinessFreqHz > 100) {
    workingSignal = applyBiquadFilter(
      workingSignal,
      sampleRate,
      'notch',
      settings.boxinessFreqHz,
      1.8,
      -7.5
    );
  }

  // Hann analysis and synthesis window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  // Precompute overlap-add normalization factor
  let colaNorm = 0;
  for (let i = 0; i < fftSize; i += hopSize) {
    colaNorm += window[i] * window[i];
  }
  const normFactor = colaNorm > 0 ? 1 / colaNorm : 1;

  const numFrames = Math.max(1, Math.floor((workingSignal.length - fftSize) / hopSize) + 1);
  const output = new Float32Array(workingSignal.length);

  // Spectral Reverberation Estimation State
  // Frame interval in seconds
  const frameIntervalSec = hopSize / sampleRate;

  // Reverb decay coefficient per frame: RT60 decay is 60 dB drop in T_60 seconds
  const rt60Sec = Math.max(0.1, settings.decayTimeMs / 1000);
  const decayPerSecDb = 60 / rt60Sec;
  const decayPerFrameLinear = Math.pow(10, -(decayPerSecDb * frameIntervalSec) / 20);

  // Multi-band frequency-dependent reverberant floor memory
  const reverbFloorMag = new Float32Array(numBins);
  const prevMag = new Float32Array(numBins);

  // Control parameters
  const suppressionStrength = Math.min(1.2, (settings.strength / 100) * 1.3);
  const transientGuard = (settings.transientPreservation / 100) * 0.7; // 0 to 0.7
  const minGainFloor = Math.max(0.04, 1.0 - (settings.strength / 100) * 0.94); // Prevents robotic gating

  const realBuf = new Float32Array(fftSize);
  const imagBuf = new Float32Array(fftSize);

  // Loop through STFT frames
  for (let f = 0; f < numFrames; f++) {
    const startSample = f * hopSize;

    // Windowed frame extraction
    for (let i = 0; i < fftSize; i++) {
      realBuf[i] = workingSignal[startSample + i] * window[i];
      imagBuf[i] = 0;
    }

    // Forward FFT
    fft.transform(realBuf, imagBuf, false);

    // Process magnitude spectrum in each frequency bin
    for (let k = 0; k < numBins; k++) {
      const real = realBuf[k];
      const imag = imagBuf[k];
      const mag = Math.sqrt(real * real + imag * imag);

      // Frequency weighting: Room reverb is most prominent between 300Hz and 4000Hz
      const binFreq = (k * sampleRate) / fftSize;
      let freqWeight = 1.0;
      if (binFreq < 200) {
        freqWeight = 0.5; // protect fundamental pitch
      } else if (binFreq > 6000) {
        freqWeight = 0.8; // protect air
      }

      // 1. Transient flux detection: energy rise means spoken phoneme attack
      const energyDelta = mag - prevMag[k];
      const isTransientAttack = energyDelta > 0.005;

      // 2. Exponential room tail decay model
      // If attack occurs, reverb floor resets to fraction of new speech onset
      // If signal is decaying, reverb floor decays according to room RT60 rate
      if (isTransientAttack) {
        reverbFloorMag[k] = Math.max(
          reverbFloorMag[k] * decayPerFrameLinear,
          mag * (1.0 - transientGuard)
        );
      } else {
        reverbFloorMag[k] = Math.max(0.00001, reverbFloorMag[k] * decayPerFrameLinear);
      }

      prevMag[k] = mag;

      // 3. Spectral subtraction / Wiener attenuation gain
      // When mag is much larger than reverbFloor, gain -> 1 (speech preserved)
      // When mag decays toward reverbFloor, gain -> minGainFloor (reverb suppressed)
      const estimatedReverb = reverbFloorMag[k] * suppressionStrength * freqWeight;
      const cleanEstimate = Math.max(0, mag - estimatedReverb);

      let gain = mag > 1e-7 ? cleanEstimate / mag : 1.0;
      gain = Math.max(minGainFloor, Math.min(1.0, gain));

      // Apply gain to positive frequency bins
      realBuf[k] *= gain;
      imagBuf[k] *= gain;

      // Symmetrical conjugate for upper bins
      if (k > 0 && k < fftSize / 2) {
        const mirrorK = fftSize - k;
        realBuf[mirrorK] = realBuf[k];
        imagBuf[mirrorK] = -imagBuf[k];
      }
    }

    // Inverse FFT
    fft.transform(realBuf, imagBuf, true);

    // Overlap-Add synthesis with Hann window
    for (let i = 0; i < fftSize; i++) {
      const outIdx = startSample + i;
      if (outIdx < output.length) {
        output[outIdx] += realBuf[i] * window[i] * normFactor;
      }
    }
  }

  // Dry/Wet Blending
  const dryMix = settings.dryWetMix / 100;
  if (dryMix < 1.0) {
    for (let i = 0; i < output.length; i++) {
      output[i] = dryMix * output[i] + (1 - dryMix) * input[i];
    }
  }

  return output;
}

/**
 * De-reverberates an entire AudioBuffer across all channels.
 */
export async function processDeReverbBuffer(
  audioBuffer: AudioBuffer,
  settings: DeReverbSettings = DEFAULT_DEREVERB_SETTINGS
): Promise<AudioBuffer> {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;

  // Use OfflineAudioContext or AudioContext to allocate new clean buffer
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const cleanBuffer = ctx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const inputData = audioBuffer.getChannelData(c);
    const cleanedData = deReverbChannel(inputData, sampleRate, settings);
    cleanBuffer.getChannelData(c).set(cleanedData);
  }

  await ctx.close();
  return cleanBuffer;
}

/**
 * Extracts a short slice of the buffer and returns both original and de-reverbed buffers for fast A/B comparison.
 */
export async function createDeReverbPreview(
  audioBuffer: AudioBuffer,
  startTime: number,
  durationSec: number,
  settings: DeReverbSettings
): Promise<{
  originalSlice: AudioBuffer;
  cleanedSlice: AudioBuffer;
}> {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;

  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const sliceSamples = Math.min(
    audioBuffer.length - startSample,
    Math.ceil(durationSec * sampleRate)
  );

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();

  const originalSlice = ctx.createBuffer(numChannels, sliceSamples, sampleRate);
  const cleanedSlice = ctx.createBuffer(numChannels, sliceSamples, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const srcChannel = audioBuffer.getChannelData(c);
    const sliceData = srcChannel.subarray(startSample, startSample + sliceSamples);
    originalSlice.getChannelData(c).set(sliceData);

    const cleanedData = deReverbChannel(sliceData, sampleRate, settings);
    cleanedSlice.getChannelData(c).set(cleanedData);
  }

  await ctx.close();
  return { originalSlice, cleanedSlice };
}

/**
 * Processes a batch of selected segments in-place within a new cloned AudioBuffer.
 * Smoothly blends boundaries with micro-crossfades to prevent clicks.
 */
export async function batchDeReverbSegments(
  audioBuffer: AudioBuffer,
  segmentsToProcess: { id: string; startTime: number; endTime: number }[],
  settings: DeReverbSettings = DEFAULT_DEREVERB_SETTINGS,
  onProgress?: (progress: number, currentSegmentId: string, current: number, total: number) => void
): Promise<AudioBuffer> {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const cleanBuffer = ctx.createBuffer(numChannels, length, sampleRate);

  // Initialize with original audio data
  for (let c = 0; c < numChannels; c++) {
    cleanBuffer.getChannelData(c).set(audioBuffer.getChannelData(c));
  }

  const total = segmentsToProcess.length;
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.005), 128); // 5ms crossfade

  for (let i = 0; i < total; i++) {
    const seg = segmentsToProcess[i];
    if (onProgress) {
      onProgress(Math.round((i / total) * 100), seg.id, i + 1, total);
    }
    // Yield to browser UI thread
    await new Promise((r) => setTimeout(r, 0));

    const startSample = Math.max(0, Math.floor(seg.startTime * sampleRate));
    const endSample = Math.min(length, Math.ceil(seg.endTime * sampleRate));
    const segLen = endSample - startSample;

    if (segLen > 100) {
      for (let c = 0; c < numChannels; c++) {
        const fullTrackData = cleanBuffer.getChannelData(c);
        const originalTrackData = audioBuffer.getChannelData(c);
        const sliceData = originalTrackData.subarray(startSample, endSample);

        const cleanedSeg = deReverbChannel(sliceData, sampleRate, settings);

        // Apply smooth boundary cross-fades with neighboring audio
        if (fadeSamples > 0 && cleanedSeg.length > fadeSamples * 2) {
          // Fade in from original at start boundary
          for (let f = 0; f < fadeSamples; f++) {
            const blend = f / fadeSamples;
            cleanedSeg[f] = blend * cleanedSeg[f] + (1 - blend) * sliceData[f];
          }
          // Fade out to original at end boundary
          for (let f = 0; f < fadeSamples; f++) {
            const blend = f / fadeSamples;
            const idx = cleanedSeg.length - 1 - f;
            cleanedSeg[idx] = blend * cleanedSeg[idx] + (1 - blend) * sliceData[idx];
          }
        }

        fullTrackData.set(cleanedSeg, startSample);
      }
    }
  }

  if (onProgress) {
    onProgress(100, '', total, total);
  }

  await ctx.close();
  return cleanBuffer;
}

