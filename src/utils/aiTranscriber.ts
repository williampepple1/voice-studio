import { encodeAudioSegmentToWav } from './wavEncoder';

export interface DraftTranscriptionResult {
  text: string;
  source: 'gemini' | 'browser' | 'fallback';
  model?: string;
  error?: string;
}

// In-memory cache for segment draft results so repeated clicks don't re-query
const draftCache = new Map<string, string>();

/**
 * Converts an ArrayBuffer to a Base64 string safely
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Generates an AI-powered draft transcription guess for a given audio segment
 */
export async function getDraftTranscription(
  audioBuffer: AudioBuffer,
  startTime: number,
  endTime: number,
  segmentId?: string
): Promise<DraftTranscriptionResult> {
  const cacheKey = segmentId
    ? `${segmentId}_${startTime.toFixed(2)}_${endTime.toFixed(2)}`
    : `${startTime.toFixed(2)}_${endTime.toFixed(2)}`;

  if (draftCache.has(cacheKey)) {
    return {
      text: draftCache.get(cacheKey)!,
      source: 'gemini',
    };
  }

  try {
    // 1. Extract 16kHz mono WAV clip for transcription model efficiency
    const { buffer: wavBuffer } = await encodeAudioSegmentToWav(
      audioBuffer,
      startTime,
      endTime,
      {
        sampleRate: 16000,
        channels: 1,
        normalize: true,
        microFade: true,
      }
    );

    const base64Audio = bufferToBase64(wavBuffer);

    // 2. Call server-side AI transcription API
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioData: base64Audio,
        mimeType: 'audio/wav',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = (data.transcription || '').trim();
      if (text && text !== '[silence]') {
        draftCache.set(cacheKey, text);
        return {
          text,
          source: 'gemini',
          model: data.model || 'gemini-3.5-transcribe',
        };
      } else if (text === '[silence]') {
        return {
          text: '',
          source: 'gemini',
          model: data.model,
          error: 'No intelligible speech detected in this audio segment.',
        };
      }
    } else {
      const errData = await response.json().catch(() => ({}));
      console.warn('Draft transcription API returned non-OK status:', response.status, errData);
      return {
        text: '',
        source: 'fallback',
        error: errData.error || `Server responded with code ${response.status}`,
      };
    }
  } catch (err: any) {
    console.error('Error generating AI draft transcription:', err);
    return {
      text: '',
      source: 'fallback',
      error: err?.message || 'Failed to connect to transcription service',
    };
  }

  return {
    text: '',
    source: 'fallback',
    error: 'No transcription available',
  };
}

/**
 * Clears cached drafts for a segment or entirely
 */
export function clearDraftCache(segmentId?: string) {
  if (!segmentId) {
    draftCache.clear();
    return;
  }
  for (const key of draftCache.keys()) {
    if (key.startsWith(segmentId)) {
      draftCache.delete(key);
    }
  }
}
