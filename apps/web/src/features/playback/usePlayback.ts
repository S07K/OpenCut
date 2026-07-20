"use client";

import { useCallback, useEffect, useRef } from "react";
import { startPlayback, tick, type TransportBounds, type TransportOrigin } from "@opencut/playback-engine";
import { AudioEngine } from "./AudioEngine";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { useEditorStore } from "@/state/editorStore";

/**
 * Drives the playhead during playback.
 *
 * The loop runs on `requestAnimationFrame` but takes its *time* from the audio
 * clock. rAF decides when to repaint; it never decides where the playhead is.
 * That split is the whole design: repaints may stutter under load, and the
 * playhead still lands exactly where the sound is.
 */
export function usePlayback(): void {
  const { store } = useMediaImportContext();

  const engineRef = useRef<AudioEngine | null>(null);
  const originRef = useRef<TransportOrigin | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPlaying = useEditorStore((state) => state.isPlaying);

  const getEngine = useCallback(() => {
    engineRef.current ??= new AudioEngine(store());
    return engineRef.current;
  }, [store]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      engineRef.current?.stopAll();
      originRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      frameRef.current = null;
      timerRef.current = null;
      return;
    }

    const engine = getEngine();
    let cancelled = false;
    let onVisibility: (() => void) | null = null;

    const begin = async () => {
      // Browsers keep audio contexts suspended until a gesture. Play is that
      // gesture, so this is where the context legitimately starts.
      await engine.resume();

      const state = useEditorStore.getState();
      await engine.prepare(state.project);
      if (cancelled) return;

      const bounds = boundsFor(state.project.durationFrames);
      const origin = startPlayback(state.playhead, engine.now(), bounds);
      originRef.current = origin;

      // Snap the playhead to wherever playback actually begins, so a play
      // pressed at the end visibly rewinds rather than jumping a frame later.
      if (origin.startFrame !== state.playhead) state.setPlayhead(origin.startFrame);

      engine.scheduleFrom(state.project, origin.startFrame, origin.rate);

      const step = () => {
        if (cancelled) return;

        const current = useEditorStore.getState();
        const activeOrigin = originRef.current;
        if (!activeOrigin) return;

        const result = tick(
          activeOrigin,
          engine.now(),
          current.project.settings.frameRate,
          boundsFor(current.project.durationFrames),
        );

        // The store holds integer frames; the fractional position stays inside
        // the transport, where audio scheduling can still use it.
        current.setPlayhead(Math.round(result.frame));

        if (result.ended) {
          current.togglePlaying();
          return;
        }

        scheduleNext();
      };

      /**
       * Schedules the next tick.
       *
       * `requestAnimationFrame` does not fire in a hidden tab, but scheduled
       * audio keeps sounding — so a purely rAF-driven loop would let a
       * backgrounded timeline play to the end and never notice, leaving the
       * transport stuck "playing" forever. A timer takes over while hidden.
       *
       * The playhead does not drift across the switch: it is derived from the
       * audio clock each tick rather than accumulated, so a coarse timer costs
       * update smoothness and nothing else.
       */
      const scheduleNext = () => {
        if (cancelled) return;

        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          timerRef.current = setTimeout(step, HIDDEN_TICK_MS);
        } else {
          frameRef.current = requestAnimationFrame(step);
        }
      };

      // Switch scheduling strategy the moment visibility changes, rather than
      // waiting for a tick that may never come.
      onVisibility = () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        frameRef.current = null;
        timerRef.current = null;
        scheduleNext();
      };
      document.addEventListener("visibilitychange", onVisibility);

      scheduleNext();
    };

    void begin();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      frameRef.current = null;
      timerRef.current = null;
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      engine.stopAll();
    };
  }, [isPlaying, getEngine]);
}

/** Tick interval while the tab is hidden and rAF is unavailable. */
const HIDDEN_TICK_MS = 100;

/** Bounds for the current timeline. Looping is not exposed in the UI yet. */
function boundsFor(durationFrames: number): TransportBounds {
  return { durationFrames: Math.max(1, durationFrames), loop: false };
}
