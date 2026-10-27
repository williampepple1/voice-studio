import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const port = 3000;

// Handle audio base64 payload up to 50MB
app.use(express.json({ limit: '50mb' }));

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// AI Draft Transcription Endpoint
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioData, mimeType = 'audio/wav', contextPrompt } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'audioData base64 string is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
        fallback: true,
      });
    }

    const audioPart = {
      inlineData: {
        mimeType: mimeType || 'audio/wav',
        data: audioData,
      },
    };

    const instruction = contextPrompt
      ? `Transcribe this short audio clip. Context: ${contextPrompt}. Return ONLY the verbatim transcribed words with natural casing and punctuation. If inaudible or pure silence, return [silence].`
      : 'Transcribe this audio segment accurately and verbatim. Return ONLY the transcribed text with proper capitalization and punctuation. Do not include quotes, timestamps, metadata, or explanations. If there is no speech, return [silence].';

    try {
      // Use gemini-3.5-transcribe for audio transcription
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            { text: instruction },
          ],
        },
      });

      const transcription = response.text ? response.text.trim() : '';
      return res.json({ transcription, model: 'gemini-3.5-transcribe' });
    } catch (modelError: any) {
      console.warn('gemini-3.5-transcribe request failed, falling back to gemini-3.8-flash:', modelError?.message);

      // Fallback model
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            audioPart,
            { text: 'Transcribe the spoken audio in this segment verbatim. Return ONLY the transcribed words with proper punctuation.' },
          ],
        },
      });

      const transcription = fallbackResponse.text ? fallbackResponse.text.trim() : '';
      return res.json({ transcription, model: 'gemini-3.8-flash' });
    }
  } catch (err: any) {
    console.error('Transcription service error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate transcription' });
  }
});

// Setup Vite dev middleware or static serving
const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.resolve('dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`VoiceSlice Full-Stack Server running on port ${port}`);
});
