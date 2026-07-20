"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's rendered size.
 *
 * Deliberately does not rely on `ResizeObserver` alone, for two reasons:
 *
 * 1. **Layout ordering.** Child layout effects run before their parents', so
 *    the first measurement of an element inside a parent that sizes itself in
 *    its own layout effect (our `SplitPane`) is legitimately `0`. Anything
 *    gated on "width > 0" would then never mount.
 * 2. **Availability.** Some embedded and headless WebKit builds never fire the
 *    observer, including its spec-guaranteed initial callback. A preview that
 *    silently stays blank there is not an acceptable failure mode.
 *
 * So: measure immediately, again after layout settles, on window resize, and
 * via `ResizeObserver` where it actually works. Redundant on purpose.
 */
export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  // Avoids re-rendering when a measurement matches what we already have; this
  // runs on every resize frame.
  const lastRef = useRef<ElementSize>({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const next = { width: rect.width, height: rect.height };

    if (next.width === lastRef.current.width && next.height === lastRef.current.height) {
      return;
    }

    lastRef.current = next;
    setSize(next);
  }, [ref]);

  useLayoutEffect(() => {
    measure();

    // Second pass after the browser has settled layout, which is when a parent
    // that sizes itself in a layout effect has finally applied its sizes.
    const frame = requestAnimationFrame(measure);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      if (ref.current) observer.observe(ref.current);
    }

    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, ref]);

  return size;
}
