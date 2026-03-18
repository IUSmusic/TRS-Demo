
<a href="LICENSE">
  <img src="images/license-badge.png" alt="License badge" width="80">
</a>


# I/US TRS Demo

Demo
https://iusmusic.github.io/TRS-Demo/

Live music transcription and notation demo.

## Runtime Architecture

The demo provides two active input paths:

### 1. Microphone Transcription
- Browser microphone capture via Web Audio and `getUserMedia`
- Real-time note-event generation
- Timeline rendering, score preview, and export integration
- Configurable gate, gain, latency, confidence, and quantization controls

### 2. MIDI Input
- Web MIDI device discovery and connection
- Live MIDI note ingestion into the transcription pipeline
- Shared rendering and export path with microphone-derived events

## Backend Implementation

The transcription architecture supports both model-backed and fallback execution paths so the system remains operational when ML initialization is unavailable.

Supported runtime modes:
- **Spotify Basic Pitch ONNX**
- **`basic-pitch-ts` fallback**
- **Heuristic fallback**

## MIDI Support

- Web MIDI access request
- input enumeration
- device connection
- note message ingestion
- event forwarding into the notation and export pipeline

## Repository Scope

This repository is a source-available browser transcription demo with:
- live microphone input
- live MIDI input
- notation preview
- export workflows
- static hosting compatibility
- model-backed and fallback transcription modes

## License

This repository is licensed under the **I/US Source-Available License 1.0**.

See `LICENSE` for the controlling terms.

Permitted use is limited to viewing, reference, study, and private internal evaluation unless separate written permission is granted. No trademark, brand, redistribution, derivative-work, or commercial rights are granted by default.

<a href="LICENSE">
  <img src="images/license-badge.png" alt="License badge" width="80">
</a>
