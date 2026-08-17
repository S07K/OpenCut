# Contributing to Cutaway

Thanks for helping build an open, local-first video editor. This guide covers
setup, the conventions that keep the codebase coherent, and how to add features
through the existing extension points instead of special-casing the renderer.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) too — it explains _why_ the
code is shaped the way it is, and most of its rules exist to avoid a specific,
known failure mode.

## Setup

Requirements: **Node 20+** and **pnpm 10+**.

```bash
pnpm install
pnpm dev            # editor at http://localhost:3000
```

This is a pnpm-workspace + Turborepo monorepo:

```
apps/web            The Next.js editor (React, PixiJS, the only app)
packages/
  types utils       Domain: pure TS, zero deps
  *-engine          Pure logic — no React, no DOM (runs in Node)
  render-engine     resolveScene: the shared preview/export keystone (pure)
  media-engine …    Adapters: browser APIs behind interfaces
  ui                Design system (React)
```

## Everyday commands

```bash
pnpm dev            # run the editor
pnpm test           # unit tests across all packages
pnpm typecheck      # type-check everything
pnpm lint           # eslint
pnpm format         # prettier write — run before committing
pnpm build          # production build
```

Turborepo caches these, so re-runs are fast. To target one package:
`pnpm --filter @cutaway/timeline-engine test`.

## The rules that matter

These are load-bearing. A change that breaks one of them will be asked to change,
however it's spelled.

1. **Engines never import React or touch the DOM.** Everything in `packages/*`
   except `ui` and the adapter layer must run headless in Node. This is what
   keeps the export path runnable without a browser and the test suite running
   in milliseconds. Browser APIs (canvas, WebCodecs, IndexedDB, `<video>`) live
   in the adapters (`media-engine`, `export-engine`, …) or in `apps/web`, behind
   an interface.

2. **Preview and export share one resolver.** `resolveScene(project, frame)` is
   the single answer to "what does frame N look like." Never add a second
   rendering path — a divergence there silently breaks the promise that export
   matches preview.

3. **Every document mutation goes through the store's `commit` helper.** Writing
   to `project` directly makes the edit unundoable _and_ desyncs the history
   snapshot from the live document. (The one sanctioned exception is a
   late-arriving thumbnail/waveform, which rewrites the present entry in place.)

4. **Every animatable property is typed `Animatable<T>`.** Don't add a raw
   number where a keyframe should be able to reach — there should be no place in
   the document to put an un-keyframeable value.

5. **The document is plain, normalized, versioned JSON.** No classes, `Date`,
   `Map`, or cycles; entities in flat id-keyed maps; bump `schemaVersion` and add
   a migration for any breaking change.

6. **`pnpm format` before you commit.** The CI format gate is strict and will
   fail an unformatted PR.

## Extending through the seams (don't special-case the renderer)

Most features have a data-shaped entry point. Prefer it.

- **A new effect** → register an `EffectDefinition` (id, name, category, param
  schema) in `effects-engine`, and add its render branch in the compositor keyed
  by the same id. The properties panel builds its UI from the schema
  automatically. Core and plugin effects use the same registry.
- **A new caption style** → add a `CaptionPreset` (data) in `caption-engine`.
- **An animation preset** → add keyframe data; presets are a UI affordance, not
  a code path.
- **A new object kind** → add one `content` variant to `Clip`. The envelope
  (transform, appearance, masks, effects, grade, transitions) works for it for
  free; touch no transform/mask/animation code.
- **A transcription or export backend** → implement the existing provider /
  `VideoWriter` / `FrameSource` interface. No caller changes.

## Testing

- **Engines are unit-tested with Vitest**, thoroughly. New pure logic ships with
  tests; put fixtures beside the code in `__tests__`.
- **`apps/web` has no unit runner** — verify UI and rendering behaviour by
  driving the actual app in a browser. A green `typecheck` is not verification
  for anything WebGL, WebCodecs, or interaction-shaped.
- Keep tests fast and DOM-free; that speed is only possible because engines
  don't import a DOM.

## Style

- **Prettier** formats; **ESLint** lints. Run `pnpm format` and `pnpm lint`.
- Match the surrounding code — comment density, naming, and idiom. Comments
  explain _why_ (the non-obvious constraint), not _what_ the line does.
- TypeScript is strict, including `noUncheckedIndexedAccess`. Prefer explicit
  interfaces at package boundaries.

## Submitting a change

1. Branch off `main`.
2. Make the change; add/adjust tests for engine logic.
3. `pnpm format && pnpm typecheck && pnpm test && pnpm lint && pnpm build` — all
   green.
4. Open a PR with a clear description of the change and how you verified it
   (including the browser check for anything visual). CI runs typecheck, test,
   lint, format, and build on every PR.

By contributing you agree your work is licensed under the project's MIT license.
