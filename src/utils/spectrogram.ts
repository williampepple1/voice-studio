/**
 * High-performance Short-Time Fourier Transform (STFT) & Spectrogram Generator
 * Computes frequency heatmaps to reveal background hiss, electrical hums, and mouth clicks.
 */

export interface SpectrogramOptions {
  fftSize?: number; // default 512
  minDecibels?: number; // default -85 dB
  maxDecibels?: number; // default -10 dB
  colorMap?: 'inferno' | 'viridis' | 'cyan';
  numTimeSlices?: number;
}

/**
 * Precomputed Cooley-Tukey Radix-2 Fast Fourier Transform
 */
class FastFFT {
  private n: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private bitReverse: Uint16Array;

  constructor(n: number) {
    this.n = n;
    this.cosTable = new Float32Array(n / 2);
    this.sinTable = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
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

  /**
   * Computes power spectrum magnitude in decibels for real input array of size n.
   */
  public computeMagnitudeDb(
    realInput: Float32Array,
    window: Float32Array,
    outputDb: Float32Array
  ): void {
    const n = this.n;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Apply Hann window and bit reversal
    for (let i = 0; i < n; i++) {
      const rev = this.bitReverse[i];
      real[rev] = realInput[i] * window[i];
      imag[rev] = 0;
    }

    // Cooley-Tukey butterflies
    for (let size = 2; size <= n; size <<= 1) {
      const halfSize = size >> 1;
      const tableStep = n / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const k = j * tableStep;
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];

          const tReal = real[i + j + halfSize] * cos - imag[i + j + halfSize] * sin;
          const tImag = real[i + j + halfSize] * sin + imag[i + j + halfSize] * cos;

          real[i + j + halfSize] = real[i + j] - tReal;
          imag[i + j + halfSize] = imag[i + j] - tImag;
          real[i + j] += tReal;
          imag[i + j] += tImag;
        }
      }
    }

    // Compute power in decibels for bins 0 to n/2
    const numBins = n / 2;
    for (let i = 0; i < numBins; i++) {
      const magSq = (real[i] * real[i] + imag[i] * imag[i]) / (n * n);
      // Convert to dB: 10 * log10(magSq)
      const db = magSq > 1e-12 ? 10 * Math.log10(magSq) : -120;
      outputDb[i] = db;
    }
  }
}

/**
 * Monochrome black, grey, and white acoustic mapping for white background
 */
function getMonochromeRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  // 0.0 (silence) -> 255 (white), 1.0 (loudest peak) -> 10 (black)
  const intensity = Math.round(255 - Math.pow(clamped, 0.8) * 245);
  return [intensity, intensity, intensity];
}

/**
 * Computes the full 2D spectrogram matrix for an AudioBuffer.
 * Returns an OffscreenCanvas or ImageData ready for fast canvas blitting.
 */
export function generateSpectrogramImageData(
  audioBuffer: AudioBuffer,
  options: SpectrogramOptions = {}
): {
  imageData: ImageData;
  width: number;
  height: number;
  sampleRate: number;
  maxFreqHz: number;
} {
  const fftSize = options.fftSize || 512;
  const numBins = fftSize / 2; // e.g. 256 frequency bins
  const minDb = options.minDecibels ?? -80;
  const maxDb = options.maxDecibels ?? -15;
  const dbRange = Math.max(10, maxDb - minDb);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const maxFreqHz = sampleRate / 2;

  // Compute number of time slices (width of spectrogram)
  const targetWidth = Math.min(2048, Math.max(800, Math.floor(audioBuffer.duration * 120)));
  const height = numBins; // height in pixels corresponds to frequency bins
  const hopSize = Math.max(1, Math.floor((channelData.length - fftSize) / targetWidth));

  const fft = new FastFFT(fftSize);

  // Precompute Hann window
  const hannWindow = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const windowSlice = new Float32Array(fftSize);
  const binDb = new Float32Array(numBins);

  // Create pixel buffer (RGBA)
  const pixelArray = new Uint8ClampedArray(targetWidth * height * 4);

  for (let x = 0; x < targetWidth; x++) {
    const startSample = x * hopSize;
    if (startSample + fftSize > channelData.length) break;

    for (let i = 0; i < fftSize; i++) {
      windowSlice[i] = channelData[startSample + i];
    }

    fft.computeMagnitudeDb(windowSlice, hannWindow, binDb);

    // Write column x from bottom (0 Hz) to top (Nyquist maxFreqHz)
    for (let bin = 0; bin < numBins; bin++) {
      const db = binDb[bin];
      const normalized = (db - minDb) / dbRange;
      const [r, g, b] = getMonochromeRgb(normalized);

      // Invert y so 0 Hz is at the bottom and max frequency is at the top
      const y = height - 1 - bin;
      const pixelIdx = (y * targetWidth + x) * 4;

      pixelArray[pixelIdx] = r;
      pixelArray[pixelIdx + 1] = g;
      pixelArray[pixelIdx + 2] = b;
      pixelArray[pixelIdx + 3] = 255;
    }
  }

  const imageData = new ImageData(pixelArray, targetWidth, height);
  return {
    imageData,
    width: targetWidth,
    height,
    sampleRate,
    maxFreqHz,
  };
}
