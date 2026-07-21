# OpenCut

An open-source, local-first, AI-powered video editor for creators.

Not a Premiere clone. The goal is the simplicity of CapCut, the motion
capabilities of After Effects, the UX of Figma, and the openness of Blender —
running entirely in your browser.

> **Status: early.** Phase 1 of 6. The shell, timeline, and document format are
> real and tested; the preview renderer and export pipeline are not built yet.
> See [Roadmap](#roadmap).

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> and start editing. No account. No cloud. No API
keys.

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

| Layer        | Packages                                         | Constraint                      |
| ------------ | ------------------------------------------------ | ------------------------------- |
| Domain       | `types`, `utils`                                 | Zero dependencies, pure TS      |
| Engines      | `timeline-engine`, …                             | Pure logic — no React, no DOM   |
| Adapters     | `media-engine`, `render-engine`, `export-engine` | Browser APIs, behind interfaces |
| Presentation | `ui`, `web`                                      | React — owns no business logic  |
| Extension    | `plugin-sdk`                                     | Frozen re-export of the above   |

Engines never import React. That is what makes the export path runnable headless
in Node and keeps the timeline test suite running in milliseconds.

**Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before making structural
changes** — most constraints there exist to avoid a specific known failure mode.

## Stack

Next.js · React · TypeScript · Tailwind · Zustand · PixiJS ·
WebCodecs with FFmpeg.wasm fallback (planned) · IndexedDB · Vitest · Playwright

## Roadmap

- [x] **Phase 1** — Monorepo, design system, docking layout, canvas timeline, media import
- [x] **Phase 2** — Preview renderer, project save, playback, undo/redo
- [ ] **Phase 3** — Animation engine, keyframes, masking
- [ ] **Phase 4** — Captions via local Whisper
- [ ] **Phase 5** — Color grading, aspect ratios, effects
- [ ] **Phase 6** — Export engine, performance, plugin SDK

Phases 1 and 2 are complete. The preview renderer composites the timeline,
projects autosave locally and restore on reload, the transport plays back
against an audio-clock timebase, and every document edit is undoable.

Projects are stored in IndexedDB and can be saved to / opened from `.opencut`
files — plain JSON you can diff in git or paste into a bug report. Loading is
repair-oriented: a corrupt clip is dropped and reported rather than refusing to
open a project someone has hours of work in. Media blobs no project references
are swept on startup.

## Development

```bash
pnpm dev         # run the editor
pnpm test        # unit tests across all packages
pnpm typecheck   # type check everything
pnpm build       # production build
```

### Shortcuts

| Key              | Action                           |
| ---------------- | -------------------------------- |
| `Space`          | Play / pause                     |
| `←` / `→`        | Step one frame (`Shift` for ten) |
| `S`              | Split at playhead                |
| `N`              | Toggle snapping                  |
| `Delete`         | Ripple delete selection          |
| `Cmd/Ctrl` + `S` | Save now                         |
| `+` / `-`        | Zoom timeline                    |
| `Home` / `End`   | Jump to start / end              |

## Contributing

Contributions welcome. Every engine package should keep its unit tests passing
and stay free of React and DOM imports. New object kinds, effects, and caption
presets should go through the existing extension points rather than adding
special cases to the renderer.

## License

MIT
