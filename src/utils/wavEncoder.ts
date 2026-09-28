/**
 * High-performance 16-bit Linear PCM WAV Encoder & Resampler
 * Generates clean audio clips optimized for TTS model training (VITS, FastSpeech, Piper, Tacotron).
 */

import { deReverbChannel, DEFAULT_DEREVERB_SETTINGS } from './deReverb';

export interface EncodeWavOptions {
  sampleRate: number; // e.g. 22050, 24000, 44100
  channels: 1 | 2; // 1 = mono, 2 = stereo
  normalize?: boolean;
  targetPeakDb?: number; // e.g. -1 dB
  microFade?: boolean; // 5ms fade in/out to eliminate cut pops
  deReverb?: boolean; // Apply room reflection & echo suppression
}

/**
 * Extracts, resamples, cleans, and encodes a segment of an AudioBuffer into a WAV Blob.
 */
export async function encodeAudioSegmentToWav(
  audioBuffer: AudioBuffer,
  startTime: number,
  endTime: number,
  options: EncodeWavOptions
): Promise<{ blob: Blob; buffer: ArrayBuffer; duration: number }> {
  const duration = Math.max(0.01, endTime - startTime);
  const targetSampleRate = options.sampleRate || 22050;
  const targetChannels = options.channels || 1;

  // Step 1: Use OfflineAudioContext for high-quality audio resampling and mixdown
  const offlineCtx = new OfflineAudioContext(
    targetChannels,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  // If mono mixdown is requested from multi-channel audio
  if (targetChannels === 1 && audioBuffer.numberOfChannels > 1) {
    const merger = offlineCtx.createChannelMerger(1);
    // Create gain node to average the channels without clipping
    const gain = offlineCtx.createGain();
    gain.gain.value = 1 / audioBuffer.numberOfChannels;
    source.connect(gain);
    gain.connect(offlineCtx.destination);
  } else {
    source.connect(offlineCtx.destination);
  }

  // Start at offset startTime and play for duration
  source.start(0, Math.max(0, startTime), duration);

  const renderedBuffer = await offlineCtx.startRendering();

  // Step 2: Post-process channel data (micro-fade & peak normalization)
  const numChannels = renderedBuffer.numberOfChannels;
  const length = renderedBuffer.length;
  const channelData: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    // Clone data for processing
    const data = new Float32Array(renderedBuffer.getChannelData(c));
    channelData.push(data);
  }

  // De-Reverberation (Acoustic room reflection suppression)
  if (options.deReverb) {
    for (let c = 0; c < numChannels; c++) {
      channelData[c] = deReverbChannel(channelData[c], targetSampleRate, DEFAULT_DEREVERB_SETTINGS);
    }
  }

  // Micro fade-in and fade-out (5ms) to prevent clicks at cut boundaries
  if (options.microFade !== false && length > 32) {
    const fadeSamples = Math.min(Math.floor(targetSampleRate * 0.005), Math.floor(length / 4));
    for (let c = 0; c < numChannels; c++) {
      const data = channelData[c];
      for (let i = 0; i < fadeSamples; i++) {
        const factor = i / fadeSamples;
        data[i] *= factor; // Fade in
        data[length - 1 - i] *= factor; // Fade out
      }
    }
  }

  // Peak normalization
  if (options.normalize) {
    let maxPeak = 0;
    for (let c = 0; c < numChannels; c++) {
      const data = channelData[c];
      for (let i = 0; i < length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }

    if (maxPeak > 0.001) {
      const targetDb = options.targetPeakDb ?? -1.0;
      const targetLinear = Math.pow(10, targetDb / 20); // e.g. -1 dB ~= 0.891
      const scale = Math.min(targetLinear / maxPeak, 10.0); // cap max gain at 10x
      for (let c = 0; c < numChannels; c++) {
        const data = channelData[c];
        for (let i = 0; i < length; i++) {
          data[i] = Math.max(-1.0, Math.min(1.0, data[i] * scale));
        }
      }
    }
  }

  // Step 3: Write RIFF WAVE 16-bit PCM binary
  const wavBytes = writeWav16BitPcm(channelData, targetSampleRate, numChannels);
  const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });

  return {
    blob,
    buffer: wavBytes.buffer as ArrayBuffer,
    duration,
  };
}

/**
 * Encodes Float32 multi-channel audio data to 16-bit PCM RIFF WAV format.
 */
function writeWav16BitPcm(
  channels: Float32Array[],
  sampleRate: number,
  numChannels: number
): Uint8Array {
  const numSamples = channels[0].length;
  const bytesPerSample = 2; // 16-bit = 2 bytes
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Helper to write ASCII string
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(8, 'WAVE');

  /* "fmt " sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)

  /* "data" sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write interleaved 16-bit PCM audio samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp between -1.0 and 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer (-32768 to 32767)
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.floor(int16), true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Format seconds into mm:ss.ms
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
}

/**
 * Parse time string mm:ss.ms or raw seconds back to number
 */
export function parseTime(str: string): number {
  if (!str) return 0;
  if (!str.includes(':')) {
    const val = parseFloat(str);
    return isNaN(val) ? 0 : val;
  }
  const parts = str.split(':');
  const mins = parseFloat(parts[0]) || 0;
  const secs = parseFloat(parts[1]) || 0;
  return mins * 60 + secs;
}
