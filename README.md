
<a href="LICENSE">
  <img src="images/license-badge.png" alt="License badge" width="70">
</a>


# I/US TRS Demo

Demo
https://iusmusic.github.io/TRS-Demo/

Live music transcription and notation demo for I/US Music.

This repository contains a source-available demo for browser-based music input, transcription, notation preview, and export workflows. The project is structured as a web-first prototype with a static demo path and a more advanced source architecture for future model-backed transcription.

## Purpose

This demo is intended to explore and present:

- live microphone and MIDI note capture
- transcription event pipelines
- notation preview and score rendering
- export paths for captured musical material
- I/US Music interaction, visual identity, and product direction

It is a demonstration and prototype repository, not a production release.

## Current Structure

### Main areas

- `apps/web` — main web application source
- `packages/` — shared packages for engines, notation, exporters, and shared types
- `.github/workflows/` — GitHub Actions workflows for deployment
- `prebuilt-static-web/` — static demo package for immediate browser hosting
- Docker-related files where included for containerized serving

### Included demo paths

This repository may include more than one runtime path:

- **source app path** for the full GitHub-ready codebase
- **prebuilt static demo path** for direct hosting without local build tooling
- **fallback audio detection path** where model-backed inference is unavailable

## Demo and experimental Features
Update (18 March 2026)
- Added `experimental.js` bootstrap loaded after `app.js`.
- Modularized runtime into:
  - `assets/js/audio.js`
  - `assets/js/transcription.js`
  - `assets/js/render.js`
  - `assets/js/exporters.js`
- Replaced full `innerHTML` refreshes with targeted DOM patching for:
  - recent notes table
  - timeline bars
  - score view note cards
- Added safer logging / error handling in audio tick, event ingestion, and MIDI handlers.
- Increased event capacity to 500 with smart pruning by recency bucket.
- Added session persistence via `localStorage`.
- Added undo support with `Ctrl/Cmd+Z`.
- Added save/share state generation with `Ctrl/Cmd+S`.
- Added automatic tempo estimation feeding quantization.
- Upgraded MusicXML export.
- Added MIDI export via **Shift+click** on the existing MusicXML button.

(17 March 2026)
- microphone input
- MIDI input
- transcription event timeline
- note display / notation preview
- score-style rendering
- controls for:
  - noise gate
  - latency / buffer
  - input gain
  - confidence threshold
  - quantization strength
- export hooks for JSON, TXT, MusicXML, and print/PDF flows
- I/US visual identity styling and logo integration

## Notes on Runtime Modes

This demo has been prepared in more than one form:

### 1. GitHub-ready source package
Intended for repository hosting, GitHub Actions, and continued development.

### 2. Prebuilt static web package
Intended for direct hosting as a static site without additional coding.

### 3. Model-backed / fallback runtime approach
Where available, the architecture may attempt:
- official Spotify Basic Pitch ONNX
- `basic-pitch-ts` fallback
- heuristic fallback when model initialization is unavailable

This is intended to keep the demo usable while preserving a path toward richer inference-based transcription.

## Intended Use

This repository is made available for:

- viewing
- reference
- study
- private internal evaluation

It is not an open-source or permissive commercial code release.

## Branding

This demo is part of the I/US Music direction and is intended to reflect the I/US visual system, including:

- brand styling
- logo usage
- dark high-contrast interface treatment
- typographic direction aligned with I/US properties

No trademark or brand rights are granted by access to this repository.

## Status

This is a prototype/demo repository.

It may contain:
- experimental code
- partially verified integrations
- scaffolded architecture
- fallback implementations used to preserve demo continuity

It should not be treated as a production-certified release.

## License

**I/US Source-Available License 1.0**

See [LICENSE](./LICENSE).

Copyright (c) 2026 Pezhman Farhangi  
I/US Music

## Contact

For licensing requests, commercial rights, redistribution requests, derivative work permissions, or permission to use protected brand assets, prior written permission must be obtained from I/US Music.


<a href="LICENSE">
  <img src="images/license-badge.png" alt="License badge" width="70">
</a>
