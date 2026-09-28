# Voice Studio

Voice Studio is a browser-based workspace for preparing clean speech datasets for text-to-speech training. It lets you load an audio recording, split it into short clips, write or import transcripts, clean room reverb, and export a ready-to-train dataset package.

The app is built with React, TypeScript, Vite, Tailwind CSS, Web Audio APIs, and JSZip.

## Features

- Drag-and-drop audio import with browser-side decoding
- Auto speech segment detection based on silence boundaries
- Waveform editing with manual cuts, zero-crossing-friendly split points, and trim controls
- Loop playback for proofreading each clip transcript
- Script import from `.txt` or `.csv` files
- Browser speech recognition support for quick dictation where available
- Bulk rename tools for dataset-friendly clip names
- De-reverb and room cleanup preview with adjustable DSP presets
- Single-clip `.wav` and `.txt` downloads
- ZIP export with paired WAV/TXT files, optional `metadata.csv`, and optional `manifest.json`
- Built-in demo track for testing the workflow without a local recording

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Lucide React icons
- Motion
- JSZip
- Google GenAI SDK

## Getting Started

### Prerequisites

- Node.js 22 or newer recommended
- Bun, npm, pnpm, or yarn

This repository includes a `bun.lock` file, so Bun is the most direct package manager to use.

### Install

```bash
bun install
```

Or with npm:

```bash
npm install
```

### Environment

Copy the example environment file and fill in values as needed:

```bash
cp .env.example .env
```

Available variables:

```bash
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="MY_APP_URL"
```

`GEMINI_API_KEY` is intended for Gemini API calls. In AI Studio, this can be injected from user secrets.

### Development

```bash
bun run dev
```

The app starts on:

```text
http://localhost:3000
```

### Build

```bash
bun run build
```

### Preview Production Build

```bash
bun run preview
```

### Type Check

```bash
bun run lint
```

## Workflow

1. Load an audio file, or use the demo track.
2. Review the detected speech segments on the waveform.
3. Add, remove, split, or adjust segment boundaries.
4. Loop each clip and enter the exact transcript.
5. Optionally import script lines, bulk rename clips, or clean room reverb.
6. Export the dataset ZIP.

## Export Format

The exported archive contains paired clips and transcripts, plus optional metadata files:

```text
project_tts_dataset.zip
├── clip_001.wav
├── clip_001.txt
├── clip_002.wav
├── clip_002.txt
├── metadata.csv
└── manifest.json
```

`metadata.csv` follows the common LJSpeech-style row format:

```text
clip_id|transcript|transcript
```

Export settings include sample rate, mono/stereo output, peak normalization, micro-fades, and optional de-reverb processing.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play or pause |
| `L` | Loop the active clip |
| `S` | Cut at the playhead |
| `Esc` | Stop audio |
| `Ctrl + [` | Previous clip |
| `Ctrl + ]` | Next clip |

## Project Structure

```text
src/
├── components/       # React UI components
├── types/            # Shared TypeScript types
├── utils/            # Audio processing, encoding, synthesis, and DSP helpers
├── App.tsx           # Main application state and workflow
├── index.css         # Tailwind and global styles
└── main.tsx          # React entry point
```

## Notes

- Most audio processing happens locally in the browser through Web Audio APIs.
- Browser support varies for speech recognition and audio decoding formats.
- For TTS training, short natural clips with accurate transcripts generally produce better datasets than long unedited recordings.
