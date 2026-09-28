# VoiceSlice Studio — Audio Dataset Curation & TTS Annotation Workstation

An interactive, high-precision audio segmentation and transcription workstation engineered for machine learning practitioners building Text-to-Speech (TTS) datasets. It enables rapid audio cleaning, interactive waveform slicing, looping segment audition, manual transcription, and export to individual WAV audio clips alongside separate TXT files.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following parameters were confirmed during the interview phase and are prioritized in the architectural design:

- **Confirmed Slicing Workflow**: Manual splitting directly by clicking on the interactive audio waveform, with draggable boundary handles, playhead scrub, and keyboard split shortcuts (`S`).
- **Confirmed Annotation Workflow**: Manual typing per segment paired with continuous looping playback, variable audition speeds (`0.75x`, `1.0x`, `1.25x`), and rapid keyboard navigation (`Tab` to jump to next clip).
- **Confirmed Dataset Export**: Bundled ZIP containing paired individual `.wav` clips and `.txt` files (e.g., `clip_0001.wav` and `clip_0001.txt`), plus an optional standard `metadata.csv` index (`clip_id|transcript`) compatible with Piper, Coqui TTS, VITS, and FastSpeech2 pipelines.

---

### 1. Overview & Core Concept

- **What It Does**: Transforms raw, long-form voice recordings (interviews, audiobooks, podcasts, voice actor sessions) into clean, trimmed, and annotated audio-text training pairs for TTS model fine-tuning.
- **Target Audience / Persona**: AI voice researchers, ML engineers, indie game developers creating custom synthetic voices, and audio dataset creators.
- **Key Value**: Replaces cumbersome multi-tool workflows (Audacity + text editor + renaming scripts) with an end-to-end browser studio that operates directly on the Web Audio API with zero server latency or data leakage.

---

### 2. User Experience & Visual Design

#### Key User Flows

1. **Ingest & Inspect**:
   - The user loads an audio file (`.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`) via drag-and-drop or selects a preloaded high-fidelity speech sample to test immediately.
   - The studio decodes the audio into 32-bit float PCM data and displays a multi-scale waveform canvas with an interactive minimap overview and zoom controls (1x to 32x).

2. **Waveform Slicing & Boundary Adjustment**:
   - Clicking on the waveform or pressing `S` while playing drops a cut marker.
   - Adjacent markers define discrete audio segments with timestamps (`00:01.240` – `00:04.850`) and duration displays.
   - Users can drag split boundaries with millisecond precision, split an existing slice, or merge adjacent segments.

3. **Looping Audition & Transcription**:
   - Selecting a segment triggers active focus and optional auto-looping playback.
   - Playback speed can be switched (`0.75x`, `1.0x`, `1.25x`) so fast speakers can be transcribed without missing words.
   - The user types the exact spoken text into the segment card. Pressing `Shift+Enter` or `Tab` automatically saves and jumps to the next slice, looping its audio immediately for a rapid transcription flow.

4. **Audio Cleaning & Preprocessing**:
   - Built-in audio preprocessors for TTS training readiness:
     - Peak Normalization (e.g., normalize to `-1.0 dBFS` or `-3.0 dBFS`).
     - DC offset removal.
     - Silence trim at clip onset/offset.
     - Target sample rate conversion (22,050 Hz, 24,000 Hz, 44,100 Hz, or original).

5. **Dataset Export**:
   - Click "Export Dataset" to generate a ZIP archive containing:
     - `/wavs/sample_0001.wav`, `/wavs/sample_0002.wav`, ... (16-bit PCM WAV)
     - `/wavs/sample_0001.txt`, `/wavs/sample_0002.txt`, ... (matching text files)
     - `/metadata.csv` (LJSpeech format: `sample_0001|text|normalized_text`)
     - `/manifest.json` (timestamps, sample rate, bit depth, duration stats)

#### Visual Identity & Theme

- **Aesthetic Direction**: High-density engineering studio (dark slate theme with precision audio accents) following `references/3_saas_dashboard.md`.
- **Color Palette**:
  - Background Canvas: Slate 950 (`#090D16`) and Slate 900 (`#0F172A`).
  - Structural Panels & Dividers: Neutral borders (`rgba(255, 255, 255, 0.08)`).
  - Waveform Display: Vivid electric cyan/amber for audio signal peaks (`#06B6D4` / `#F59E0B`).
  - Active Playhead & Slices: Bright emerald/amber boundaries for active segment selection (`#10B981` / `#6366F1`).
  - Text & Accents: Crisp white headings, Slate 400 secondary prose, tabular numerals on all timecodes (`tabular-nums font-mono`).
- **Typography**:
  - Display & Headings: `Plus Jakarta Sans` / `Cabinet Grotesk` (clean, contemporary sans).
  - Data & Timecodes: `JetBrains Mono` / tabular numbers for time offsets, sample rates, and duration badges.

---

### 3. Key Product Decisions & Trade-Offs

- **Client-Side Web Audio API Processing**:
  - *Chosen Approach*: Decode, slice, and encode audio entirely in the client using the browser's `AudioContext` and an optimized binary WAV encoder.
  - *Why*: Eliminates file size upload limits, preserves 100% audio privacy for proprietary voice actor datasets, and provides zero-latency scrubbing and playback.
  - *Alternatives Considered*: Server-side FFmpeg processing was rejected because it introduces file upload bottlenecks, server costs, and privacy concerns for private training data.

- **Non-Destructive Slicing Model**:
  - *Chosen Approach*: Segment boundaries store start and end sample offsets without duplicating or modifying the original audio buffer in memory during editing. Slices are extracted and encoded to separate WAV files only on demand or export.
  - *Why*: Extremely memory efficient even for 1-hour audio files, allowing instantaneous undo/redo and seamless boundary dragging.

- **Persistent Session State**:
  - *Chosen Approach*: Automatically save slice boundaries, transcripts, and metadata to IndexedDB / localStorage so users never lose work on accidental page refresh.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Top Navigation Bar                              │
│  [VoiceSlice Studio]   ·   File Name / Stats   ·   [Reset] [Export ZIP] │
└────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
┌───────────────────────────────────┐   ┌────────────────────────────────┐
│      Interactive Waveform Canvas   │   │     Segment Inspection List    │
│  ┌─────────────────────────────┐  │   │  ┌──────────────────────────┐  │
│  │ Minimap / Overview Strip    │  │   │  │ Clip #1 [00:00 - 00:03]  │  │
│  ├─────────────────────────────┤  │   │  │ Text: "The quick brown..."│  │
│  │ Main Waveform Display       │  │   │  │ [▶ Loop] [Delete] [Trim] │  │
│  │ (Zoom, Markers, Playhead)   │  │   │  ├──────────────────────────┤  │
│  └─────────────────────────────┘  │   │  │ Clip #2 [00:03 - 00:07]  │  │
│  Transport Bar:                   │   │  │ Text: "...jumped over"   │  │
│  [Play/Pause] [Split 'S'] [Zoom]  │   │  │ [▶ Loop] [Delete] [Trim] │  │
│  [Speed: 0.75x/1.0x/1.25x] [Vol]  │   │  └──────────────────────────┘  │
└───────────────────────────────────┘   └────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    WAV Slicer & ZIP Export Pipeline                    │
│  32-bit PCM Buffer ──> Sample Extract ──> 16-bit WAV PCM ──> JSZip    │
│  Transcript Text   ──> .txt Generator  ──> metadata.csv ───┘           │
└────────────────────────────────────────────────────────────────────────┘
```

#### Core Data Entities

- `AudioSession`: Original audio buffer, sample rate, channels, filename, total duration.
- `AudioSegment`:
  - `id`: Unique clip identifier (e.g. `clip_0001`).
  - `startTime`: Floating point seconds.
  - `endTime`: Floating point seconds.
  - `text`: Transcribed string content.
  - `isNormalized`: Flag if preprocessed (silence trimmed / normalized).
- `ExportConfig`:
  - Format: Paired WAV + TXT (primary) + metadata.csv.
  - Output Sample Rate: 22,050 Hz / 24,000 Hz / 44,100 Hz / Original.
  - Channels: Mono (recommended for TTS) or Stereo.
  - Audio Bit Depth: 16-bit PCM.
