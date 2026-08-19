# Cutaway

An open-source, local-first, AI-ready video editor for creators — running
entirely in your browser.

Not a Premiere clone. The goal is the simplicity of CapCut, the motion of After
Effects, the UX of Figma, and the openness of Blender.

> **Status: in active development.** The full editing loop works — import,
> multi-track timeline, WebGL preview, playback, undo/redo, masking, captions,
> **on-device Whisper transcription**, color, effects, chroma key, transitions,
> and **export to MP4/WebM with audio**. What's next is depth: frame-exact
> WebCodecs export and the plugin SDK. See [Roadmap](#roadmap).

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> and start editing. No account. No cloud. No API
keys. Your footage never leaves your machine.

## What it does

- **Multi-track timeline** — layer video/image clips (backgrounds, overlays,
  picture-in-picture, watermarks) and audio tracks. Canvas-rendered for speed,
  with snapping, ripple delete, split, and drag-to-trim. Add tracks as you need
  them.
- **Media, local** — import video, audio, and images; everything is stored in
  IndexedDB and autosaves. Projects save to / open from plain-JSON `.cutaway`
  files you can diff in git.
- **WebGL preview** — a PixiJS compositor renders the timeline in realtime. It
  consumes the _same_ resolved scene the exporter does, so **what you export is
  what you previewed**.
- **Motion** — every property is keyframeable, with easing and one-click
  entrance/exit presets (Fade / Pop / Slide).
- **Masking & compositing** — rectangle, ellipse, and freeform masks with
  invert and feather. Mask a clip to reveal the layer behind it.
- **Captions** — type a caption and it drops onto the timeline as a styled,
  animated block (TikTok / Hormozi / MrBeast / Instagram / Ali Abdaal styles,
  with word-by-word highlighting). Blocks are draggable, snap, and trim on the
  timeline so you can sync them to the audio. Auto-transcription runs on-device
  with Whisper (transformers.js — WebGPU when available, WASM otherwise) behind a
  swappable provider interface, so nothing leaves your machine and no account or
  API key is ever required.
- **Color & effects** — color grading (exposure, contrast, saturation, and more)
  with look presets, plus an open-world effects registry (Gaussian blur, noise,
  and anything a plugin adds).
- **Transitions** — crossfade or dip-to-black between adjacent clips.
- **Export** — WebCodecs encoding muxed to MP4 or WebM, with a mixed audio
  track, choosable resolution / frame rate / quality, an in/out range, live
  progress, and cancel. Runs entirely in the browser.

## Principles

**Local-first, permanently.** The editor must stay fully usable without paying
for any service. No OpenAI, Anthropic, Gemini, ElevenLabs, or AssemblyAI
dependency in core — AI features run on local Whisper, ONNX, and WASM. Cloud
providers are opt-in plugins behind a provider interface; they can never become
required.

**Everything is data.** Projects are plain JSON. Caption presets are JSON.
Animation presets are JSON. Effects are registry keys plus parameter bags. If a
feature can be authored as data instead of code, it is — that is what lets the
community extend the editor without forking it.

**Plugins use the same road as core.** A plugin-provided effect and a built-in
effect are indistinguishable to the document. There is no privileged side
entrance.

## Architecture

The editor is a pure function of a JSON document. Preview and export walk the
**same** scene graph, so what you export is what you previewed.

Dependencies point downward only:

| Layer        | Packages                                                         | Constraint                      |
| ------------ | ---------------------------------------------------------------- | ------------------------------- |
| Domain       | `types`, `utils`                                                 | Zero dependencies, pure TS      |
| Engines      | `timeline-engine`, `animation-engine`, `render-engine`, …        | Pure logic — no React, no DOM   |
| Adapters     | `media-engine`, `export-engine`, `project-io`, `playback-engine` | Browser APIs, behind interfaces |
| Presentation | `ui`, `apps/web`                                                 | React — owns no business logic  |

Engines never import React. That is what makes the export path runnable headless
in Node and keeps the timeline test suite running in milliseconds.

**Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before making structural
changes** — most constraints there exist to avoid a specific known failure mode.

## Stack

Next.js · React · TypeScript · Tailwind · Zustand · PixiJS (WebGL) · WebCodecs
with `mp4-muxer` / `webm-muxer` · IndexedDB · pnpm workspaces · Turborepo ·
Vitest

## Roadmap

- [x] **Phase 1** — Monorepo, design system, docking layout, canvas timeline, media import
- [x] **Phase 2** — Preview renderer, project save, playback, undo/redo
- [x] **Phase 3** — Animation engine, keyframes, masking
- [x] **Phase 4** — Captions (typed + styled + on-timeline), provider interface
- [x] **Phase 5** — Color grading, aspect ratios, effects, transitions
- [x] **Phase 6** — Export engine (WebCodecs + muxers, video + audio + range)

- [x] **Phase 7** — On-device Whisper transcription (transformers.js, WebGPU/WASM)

Next up:

- [ ] Frame-exact video export via a WebCodecs `VideoDecoder` source
- [ ] The `plugin-sdk` package — a frozen, versioned re-export for third parties
- [ ] More effects and transitions; documentation and performance passes

## Development

```bash
pnpm dev         # run the editor
pnpm test        # unit tests across all packages
pnpm typecheck   # type check everything
pnpm lint        # lint
pnpm format      # format (run before committing)
pnpm build       # production build
```

Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Shortcuts

| Key              | Action                           |
| ---------------- | -------------------------------- |
| `Space`          | Play / pause                     |
| `←` / `→`        | Step one frame (`Shift` for ten) |
| `S`              | Split at playhead                |
| `N`              | Toggle snapping                  |
| `I` / `O`        | Set export in-point / out-point  |
| `Delete`         | Ripple delete selection          |
| `Cmd/Ctrl` + `Z` | Undo (`Shift` to redo)           |
| `Cmd/Ctrl` + `S` | Save now                         |
| `+` / `-`        | Zoom timeline                    |
| `Home` / `End`   | Jump to start / end              |

## License

MIT
