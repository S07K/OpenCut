# Cutaway Architecture

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

| Layer        | Packages                                                                                                                                    | Constraint                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Domain       | `types`, `utils`                                                                                                                            | Zero dependencies. Pure TS. No React, no DOM.           |
| Engines      | `timeline-engine`, `animation-engine`, `render-engine`, `mask-engine`, `color-engine`, `effects-engine`, `history-engine`, `caption-engine` | Pure logic and math. No React, no canvas. Runs in Node. |
| Adapters     | `media-engine`, `export-engine`, `project-io`, `playback-engine`                                                                            | Browser APIs live here, behind interfaces.              |
| Presentation | `ui`, `apps/web`                                                                                                                            | React. Owns no business logic.                          |
| Extension    | `plugin-sdk` _(planned)_                                                                                                                    | A frozen, versioned re-export of the layers above.      |

**Why engines must not import React:** it makes the export path runnable
headless in Node with no refactor, and it makes timeline logic testable in
milliseconds instead of through a browser. The `timeline-engine` suite runs in a
few milliseconds — only possible because nothing in it touches a DOM.

## Document invariants

The `ProjectDocument` in `@cutaway/types` obeys three rules that everything
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

## The rendering path

`resolveScene(project, frame)` returns a flat, fully-resolved draw list. The
realtime preview and the headless exporter both consume it, so there is exactly
one implementation of "what does frame N look like".

Backends decide _how_ to draw. **PixiJS (WebGL)** is the preview backend, because
color grading, blur, and masks are shader problems. Mask _editing_ is drawn as a
lightweight **SVG overlay** on top of the canvas, where vector handles and hit
targets are genuinely SVG's strength; the mask geometry it edits is resolved by
`mask-engine` and filled by Pixi, so the overlay never renders the final result.

### Rules the Pixi backend must keep

Each of these was a bug before it was a rule:

- **One canvas per Pixi `Application`.** React owns a container `<div>`; each
  `Application` gets its own freshly-created `<canvas>`, removed on teardown —
  never a single shared canvas. Pixi init is async and StrictMode/HMR mount the
  effect twice, so two Applications can briefly coexist; if they shared a canvas,
  destroying the first would release that canvas's WebGL context and kill the
  second. This presented as "could not initialise shader" / "context lost" and
  looked like a dead sandbox until it was isolated to this.
- **Never let Pixi remove the canvas.** `app.destroy(true, …)` means
  `removeView: true`, which deletes the element. Always
  `destroy({ removeView: false }, …)` and remove the canvas yourself.
- **Await init before destroy.** Pixi's init is async, React's cleanup is not.
  Tearing down mid-init leaves a half-built Application holding a WebGL context.
- **`filters = null`, never `[]`, when a clip has none.** An empty filter list
  still triggers a filter render pass, and that pass over a _masked_ object
  renders it solid black — so masks appeared to erase content rather than reveal
  the layer behind. Set `null` to skip the pass.
- **Reconcile display objects by clip id.** Rebuilding the stage per frame
  thrashes the GPU and discards uploaded textures.
- **Handle WebGL context loss.** Contexts are taken away by driver resets, power
  events, and too many live contexts. Without a `webglcontextlost` handler that
  calls `preventDefault`, the browser never offers a restore and the preview is
  a blank frame with no explanation.

The top track in the timeline draws in **front** (earlier in `trackOrder` = higher
z), the standard NLE convention. Layering, masking-to-reveal, overlays, and
picture-in-picture all fall out of this plus per-clip opacity.

## Undo/redo

History stores **immutable document snapshots**, not `apply`/`invert` command
pairs. This revises the original plan, deliberately:

- A hand-written `invert` can be subtly wrong, and a wrong inverse corrupts the
  user's project _silently_ — the worst failure mode an editor has. A snapshot
  cannot be wrong; it is what the document was.
- The document is normalized and updated immutably, so unchanged entities are
  shared by reference between snapshots. Storing the previous document costs
  only the nodes that changed. This is precisely what document invariant (2)
  was chosen to buy.
- Undo and redo are O(1) pointer moves instead of replayed computation.

Intent is still first-class: each entry carries a label for the UI and a merge
key so a gesture collapses into one step.

**Every document mutation must go through the store's `commit` helper.** Writing
to `project` directly makes the edit unundoable _and_ desynchronizes the
history's snapshot from the live document. The one deliberate exception is a
late-arriving thumbnail or waveform, which rewrites the present entry in place —
it is an async artifact of an import the user already performed, not an action
of theirs, and an undo step for it would appear to do nothing.

### Gesture merging is sealed, not timed

Merging ends when the caller says the gesture ended (pointer-up), never after an
elapsed window. A user positioning a clip carefully pauses mid-drag, and a time
window splits that one gesture into several undo steps — which is exactly what
testing this against a real drag revealed.

## The transport

`AudioContext.currentTime` is the timebase for the entire editor. It is
monotonic, hardware-backed, and does not stall when the main thread is busy —
unlike `requestAnimationFrame`, which drops frames under load and would let the
playhead fall behind the sound. **Audio leads; video chases.**

Two rules make this work:

- **The playhead is derived, never accumulated.** Each tick computes the frame
  from `(now - startedAt)` against the clock, rather than adding a delta to the
  previous position. Accumulating keeps every rounding error forever and visibly
  desyncs after a few minutes; deriving bounds the error to one tick, always.
  This is also why the transport self-corrects instantly after any stall.
- **Audio is scheduled ahead on the clock**, not started by a timer, so a clip
  begins on exactly its frame rather than whenever a callback happened to fire.

`requestAnimationFrame` decides _when to repaint_. It never decides where the
playhead is. And because rAF does not fire in a hidden tab while scheduled audio
keeps sounding, the loop falls back to a timer when the document is hidden —
otherwise a backgrounded timeline would play to the end and never notice it had
finished.

Video elements are seeked precisely while scrubbing, but during playback they
run under their own decoder and are only nudged on gross drift. Assigning
`currentTime` every frame fights the decoder and stutters far worse than the
drift it corrects.

### Measuring elements for canvas sizing

Use `useElementSize`, never a bare `ResizeObserver`. Child layout effects run
before their parents', so the first measurement of anything inside `SplitPane`
is legitimately `0` — and any code gated on `width > 0` would never mount. Some
embedded WebKit builds also never fire the observer at all.

## Export

`export-engine` is pure and generic over an opaque frame type, so it never names
`VideoFrame` or a muxer. It plans which frames to render, drives the
render→encode loop, reports progress, and handles cancellation, all through two
interfaces — `FrameSource<TFrame>` and `VideoWriter<TFrame>` — that the browser
backends bind to the real types. Because the frame source is
`resolveScene` → the same Pixi compositor as preview, the file matches the
preview frame for frame.

- **WebCodecs, muxed with `mp4-muxer` / `webm-muxer`** (both MIT, in-browser, no
  paid API). `VideoEncoder` runs in `realtime` latency mode (no B-frames, so
  decode order == presentation order); audio is mixed offline through an
  `OfflineAudioContext`, encoded with `AudioEncoder`, and muxed into the same
  container. A `NodeBackend` and an FFmpeg.wasm fallback are possible future
  backends behind the same `VideoWriter` seam, but are not built — WebCodecs
  coverage in modern Chromium made them unnecessary for now.
- **Frame accuracy** is currently bounded by `<video>` seeking; a WebCodecs
  `VideoDecoder` frame source is the planned refinement, and slots in behind the
  same `FrameSource` interface with no engine change.

## Transitions

A transition is stored on the **incoming** clip (`Clip.transitionIn`), so a cut
owns exactly one transition and the two sides can't disagree. It lives in the
pure resolver: `transitionOpacity()` drives both visibility and opacity — the
incoming clip fades in over its first _D_ frames, and the outgoing clip is
rendered _past its own end_ (a tail) fading out, so the two overlap across the
cut. `crossfade` dissolves them; `dip` routes both through black. Preview and
export share the resolver, so a transition renders identically in both.

## Other decisions, recorded so they are not silently relitigated

- **Commands, not `setState`.** _(Revised — see "Undo/redo" above.)_ History
  stores snapshots rather than invertible commands; intent still lives at the
  action layer, which is what macros and scripting will build on.
- **Audio clock is the master clock.** _(Implemented.)_ See "The transport".
- **Timeline renders to canvas, not DOM.** DOM timelines degrade badly past
  roughly 200 clips. _(Implemented — clips, captions, and the ruler all draw to
  one canvas.)_

## Local-first, always

Core depends on no paid API and no account. AI capability sits behind an
`AIProvider` interface whose default implementation is local Whisper. Cloud
providers are plugins a user installs; they can never become required.
