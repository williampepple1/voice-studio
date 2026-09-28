/**
 * Silence Detection & Zero-Crossing Utilities for Precision Audio Cutting
 */

export interface SilenceDetectorOptions {
  silenceThresholdDb?: number; // e.g. -35 dB
  minSilenceDurationSec?: number; // e.g. 0.3s
  minSpeechDurationSec?: number; // e.g. 0.8s
  paddingSec?: number; // pad speech boundaries by e.g. 0.05s
}

export interface DetectedSegment {
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Finds the nearest zero-crossing around a given time to avoid pops/clicks.
 */
export function findNearestZeroCrossing(
  buffer: AudioBuffer,
  timeSec: number,
  searchWindowMs = 20
): number {
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0);
  const targetSample = Math.round(timeSec * sampleRate);
  const windowSamples = Math.round((searchWindowMs / 1000) * sampleRate);

  const startSample = Math.max(0, targetSample - windowSamples);
  const endSample = Math.min(channelData.length - 1, targetSample + windowSamples);

  let bestSample = targetSample;
  let minAbsDiff = Infinity;

  for (let i = startSample; i < endSample; i++) {
    const current = channelData[i];
    const next = channelData[i + 1];

    // Check for sign change (crossing zero)
    if ((current <= 0 && next >= 0) || (current >= 0 && next <= 0)) {
      const distance = Math.abs(i - targetSample);
      if (distance < minAbsDiff) {
        minAbsDiff = distance;
        bestSample = i;
      }
    }
  }

  return bestSample / sampleRate;
}

/**
 * Analyzes audio buffer energy to detect active speech segments separated by silence.
 */
export function detectSpeechSegments(
  buffer: AudioBuffer,
  options: SilenceDetectorOptions = {}
): DetectedSegment[] {
  const {
    silenceThresholdDb = -35,
    minSilenceDurationSec = 0.35,
    minSpeechDurationSec = 0.8,
    paddingSec = 0.05,
  } = options;

  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0);
  const linearThreshold = Math.pow(10, silenceThresholdDb / 20);

  // Analyze in 20ms frames
  const frameSize = Math.floor(sampleRate * 0.02);
  const numFrames = Math.floor(channelData.length / frameSize);
  const isSpeech = new Uint8Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    let sumSquares = 0;
    const offset = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const s = channelData[offset + i];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / frameSize);
    if (rms > linearThreshold) {
      isSpeech[f] = 1;
    }
  }

  // Smooth short silences (bridge silence gaps shorter than minSilenceDuration)
  const minSilenceFrames = Math.ceil((minSilenceDurationSec * sampleRate) / frameSize);
  let silenceCount = 0;

  for (let f = 0; f < numFrames; f++) {
    if (isSpeech[f] === 0) {
      silenceCount++;
    } else {
      if (silenceCount > 0 && silenceCount < minSilenceFrames) {
        // Bridge the small gap as speech
        for (let j = f - silenceCount; j < f; j++) {
          isSpeech[j] = 1;
        }
      }
      silenceCount = 0;
    }
  }

  // Extract speech chunks
  const segments: DetectedSegment[] = [];
  let inSpeech = false;
  let segmentStartFrame = 0;

  for (let f = 0; f < numFrames; f++) {
    if (isSpeech[f] === 1 && !inSpeech) {
      inSpeech = true;
      segmentStartFrame = f;
    } else if (isSpeech[f] === 0 && inSpeech) {
      inSpeech = false;
      const startSec = Math.max(0, (segmentStartFrame * frameSize) / sampleRate - paddingSec);
      const endSec = Math.min(buffer.duration, (f * frameSize) / sampleRate + paddingSec);
      const duration = endSec - startSec;

      if (duration >= minSpeechDurationSec) {
        // Refine with zero-crossing
        const refinedStart = findNearestZeroCrossing(buffer, startSec);
        const refinedEnd = findNearestZeroCrossing(buffer, endSec);
        segments.push({
          startTime: Number(refinedStart.toFixed(3)),
          endTime: Number(refinedEnd.toFixed(3)),
          duration: Number((refinedEnd - refinedStart).toFixed(3)),
        });
      }
    }
  }

  // Close trailing segment if active
  if (inSpeech) {
    const startSec = Math.max(0, (segmentStartFrame * frameSize) / sampleRate - paddingSec);
    const endSec = buffer.duration;
    const duration = endSec - startSec;
    if (duration >= minSpeechDurationSec) {
      const refinedStart = findNearestZeroCrossing(buffer, startSec);
      segments.push({
        startTime: Number(refinedStart.toFixed(3)),
        endTime: Number(endSec.toFixed(3)),
        duration: Number((endSec - refinedStart).toFixed(3)),
      });
    }
  }

  return segments;
}
