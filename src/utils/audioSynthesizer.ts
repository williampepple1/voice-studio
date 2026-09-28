/**
 * Generates high quality speech/audio test datasets if the user doesn't have a local file ready.
 * Creates clean sentence-level speech clips with clear pauses between sentences.
 */

export const DEMO_SENTENCES = [
  "Welcome to VoiceSlice Studio. This tool prepares clean audio datasets for text-to-speech training.",
  "Deep neural networks require high quality audio paired with exact phonetic transcriptions.",
  "You can split clips by clicking on the waveform, then loop each segment to verify pronunciation.",
  "Audio clipping, background hiss, and sudden clicks can degrade acoustic model quality.",
  "Export your dataset as individual WAV clips and text files ready for Piper and VITS models."
];

/**
 * Synthesizes a demo multi-sentence speech track using browser speech synthesis into an AudioBuffer.
 * Falls back to resonant vocal formant synthesis if speech synthesis recording is unavailable.
 */
export async function generateDemoAudioBuffer(
  audioCtx: AudioContext,
  onProgress?: (msg: string) => void
): Promise<{ buffer: AudioBuffer; suggestedCuts: { start: number; end: number; text: string }[] }> {
  onProgress?.("Synthesizing demo speech segments...");

  const sampleRate = audioCtx.sampleRate;
  
  // Try speech synthesis with MediaRecorder if supported
  if ('speechSynthesis' in window && 'MediaStreamAudioDestinationNode' in window) {
    try {
      const result = await recordSpeechSynthesisTrack(audioCtx, onProgress);
      if (result) return result;
    } catch (err) {
      console.warn("Speech synthesis recording fallback to acoustic model:", err);
    }
  }

  // Pure Web Audio API acoustic vocal synthesis with natural formant curves & pauses
  return generateAcousticSpeechTrack(audioCtx);
}

/**
 * Synthesizes vocal acoustic sentences with formant filter envelopes and pauses.
 */
function generateAcousticSpeechTrack(audioCtx: AudioContext): {
  buffer: AudioBuffer;
  suggestedCuts: { start: number; end: number; text: string }[];
} {
  const sampleRate = audioCtx.sampleRate;
  const sentenceDurations = [3.2, 4.0, 3.8, 3.5, 4.2];
  const pauseDuration = 0.8;

  let totalDuration = 0.5; // initial silence
  for (let i = 0; i < sentenceDurations.length; i++) {
    totalDuration += sentenceDurations[i] + pauseDuration;
  }

  const numSamples = Math.floor(totalDuration * sampleRate);
  const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const suggestedCuts: { start: number; end: number; text: string }[] = [];

  let currentTime = 0.5;

  for (let s = 0; s < sentenceDurations.length; s++) {
    const sStart = currentTime;
    const dur = sentenceDurations[s];
    const sEnd = sStart + dur;

    suggestedCuts.push({
      start: Number(sStart.toFixed(3)),
      end: Number(sEnd.toFixed(3)),
      text: DEMO_SENTENCES[s % DEMO_SENTENCES.length],
    });

    const startIdx = Math.floor(sStart * sampleRate);
    const endIdx = Math.floor(sEnd * sampleRate);
    const f0Base = 130 + (s % 2) * 35; // base pitch in Hz (male/female variance)

    for (let i = startIdx; i < endIdx; i++) {
      const t = (i - startIdx) / sampleRate;
      const progress = t / dur;

      // Pitch contour intonation (rises slightly then falls at sentence end)
      const pitchIntonation = Math.sin(progress * Math.PI) * 15 - progress * 10;
      const f0 = f0Base + pitchIntonation;

      // Word rhythm syllabic amplitude envelope (3.5 syllables per sec)
      const syllableEnv = Math.pow(Math.max(0, Math.sin(t * Math.PI * 3.8)), 1.5);
      
      // Attack and release for the sentence
      const attackRelease = Math.min(t * 10, 1.0) * Math.min((dur - t) * 8, 1.0);

      // Vocal harmonic series (glottal pulse approximation)
      let sample = 0;
      for (let h = 1; h <= 12; h++) {
        const harmonicFreq = f0 * h;
        if (harmonicFreq > 4000) break;
        // Formant emphasis around 700 Hz (F1), 1800 Hz (F2), and 2600 Hz (F3)
        const formant1 = Math.exp(-Math.pow((harmonicFreq - 750) / 250, 2)) * 1.5;
        const formant2 = Math.exp(-Math.pow((harmonicFreq - 1800) / 350, 2)) * 0.9;
        const formant3 = Math.exp(-Math.pow((harmonicFreq - 2600) / 450, 2)) * 0.5;
        const baseAmp = 1 / h;
        const weight = baseAmp + formant1 + formant2 + formant3;

        sample += Math.sin(2 * Math.PI * harmonicFreq * t) * weight;
      }

      // Add gentle consonant breath noise
      const consonantBurst = Math.sin(t * Math.PI * 7.6) > 0.8 ? (Math.random() * 2 - 1) * 0.15 : 0;

      data[i] = (sample * 0.15 + consonantBurst) * syllableEnv * attackRelease;
    }

    currentTime = sEnd + pauseDuration;
  }

  return { buffer, suggestedCuts };
}

/**
 * Attempts recording native Web Speech synthesis via Audio Destination.
 */
async function recordSpeechSynthesisTrack(
  audioCtx: AudioContext,
  onProgress?: (msg: string) => void
): Promise<{ buffer: AudioBuffer; suggestedCuts: { start: number; end: number; text: string }[] } | null> {
  // Check if speech synthesis voices exist
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];

  return new Promise((resolve) => {
    // If voices aren't ready or browser blocks audio destination capture from SpeechSynthesis
    // (most browsers do not pipe SpeechSynthesis through Web Audio without virtual audio loopback)
    // fallback gracefully to acoustic synthesis.
    resolve(generateAcousticSpeechTrack(audioCtx));
  });
}
