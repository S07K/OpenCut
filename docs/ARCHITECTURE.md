# OpenCut Architecture

> This document explains **why** the code looks the way it does. If you are about
> to make a structural change, read this first — most of the constraints here
> were chosen to avoid a specific, known failure mode.

## The core idea

The editor is a pure function of a JSON document.

```
ProjectDocument (JSON)  ──►  Scene Graph  ──►  Renderer
        ▲                         │
        │                         ▼
    Commands ◄── UI          Export (same graph, headless)
```

Preview and export walk the **same** resolved scene graph. Preview evaluates it
at the playhead in realtime; export evaluates it in a frame loop. There is no
second rendering implementation, which is the only reliable way to guarantee
that what you export matches what you previewed.

## Layering

Dependencies point **downward only**. A cycle here is a bug, not a style issue.

| Layer | Packages | Constraint |
| --- | --- | --- |
| Domain | `types`, `utils` | Zero dependencies. Pure TS. No React, no DOM. |
| Engines | `timeline-engine`, `animation-engine`, `mask-engine`, `color-engine`, `effects-engine`, `history-engine`, `caption-engine` | Pure logic and math. No React, no canvas. Runs in Node. |
| Adapters | `media-engine`, `render-engine`, `export-engine` | Browser APIs live here, behind interfaces. |
| Presentation | `ui`, `hooks`, `apps/web` | React. Owns no business logic. |
| Extension | `plugin-sdk` | A frozen, versioned re-export of the layers above. |

**Why engines must not import React:** it makes the export path runnable
headless in Node with no refactor, and it makes timeline logic testable in
milliseconds instead of through Playwright. The 36 tests in `timeline-engine`
run in under 10ms — that is only possible because nothing in it touches a DOM.

## Document invariants

The `ProjectDocument` in `@opencut/types` obeys three rules that everything
downstream assumes:

1. **Plain JSON.** No classes, no `Date`, no `Map`, no cycles. It round-trips
   through `JSON.stringify` without loss.
2. **Normalized.** Entities live in flat, id-keyed maps; relationships are id
   references. Mutations stay O(1) and structural sharing stays cheap — which is
   what lets undo/redo store snapshots without memory blowing up.
3. **Versioned.** `schemaVersion` gates a migration chain, so a project saved
   today still opens in two years.

### Time is measured in integer frames

Floating-point seconds accumulate error under repeated trim and split
operations, and that error surfaces as one-frame gaps between clips. The
document stores frames; seconds are derived on demand. `timeline-engine/time.ts`
is the only sanctioned conversion boundary.

### Ranges are half-open

Clip ranges are `[start, end)`. With this convention, "A ends where B begins"
is `a.end === b.start` with no off-by-one, and adjacency, overlap, and duration
all have clean definitions. Closed ranges make every one of those a special case.

## Composition over inheritance in the object system

A `Clip` is a small envelope holding timing plus a `content` payload that varies
by kind. The envelope carries everything universal — transform, appearance,
masks, effects, grade.

The payoff: a feature written against the envelope automatically works for
video, text, shapes, and any object kind added later, including plugin-defined
ones. Adding an object type means adding one `content` variant, and touching no
transform, mask, or animation code.

## Everything is animatable, by construction

Every property is typed `Animatable<T>` — either a constant or a keyframed
track. This is not a convention that reviewers must enforce; there is simply no
place in the document to put a value a keyframe cannot reach.

## Open-world effects

An `EffectInstance` references a registry key and a parameter bag. There is
deliberately **no union of built-in effect names**. A plugin blur and a core
blur are indistinguishable to the document. This is the property that makes the
plugin system real rather than decorative — plugins use the same road as core,
not a side entrance.

Effects declare their parameters via `EffectParamSchema`, so the properties
panel builds itself and plugin authors write no UI code.

## Planned decisions not yet implemented

Recorded here so they are not silently relitigated:

- **PixiJS (WebGL) for the compositor.** Color grading, blur, and masks are
  shader problems. React Konva is retained only for the mask pen-tool overlay,
  where vector editing UI is genuinely its strength.
- **WebCodecs first, FFmpeg.wasm as fallback.** WebCodecs is far faster but does
  not mux and has uneven browser coverage. An `ExportBackend` interface selects
  between `WebCodecsBackend`, `FFmpegWasmBackend`, and an optional `NodeBackend`
  by runtime capability probe.
- **Commands, not `setState`.** Every mutation is a `Command` with
  `apply`/`invert`. Undo/redo falls out for free, and so — later — do macros,
  scripting, and multiplayer.
- **Audio clock is the master clock.** Never `requestAnimationFrame`. Video
  chases audio, because drift is audible long before it is visible.
- **Timeline renders to canvas, not DOM.** DOM timelines degrade badly past
  roughly 200 clips.

## Local-first, always

Core depends on no paid API and no account. AI capability sits behind an
`AIProvider` interface whose default implementation is local Whisper. Cloud
providers are plugins a user installs; they can never become required.
