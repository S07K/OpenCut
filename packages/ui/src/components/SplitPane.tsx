"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

export interface SplitPaneChild {
  /** Stable key, also used to persist this pane's size. */
  id: string;
  content: ReactNode;
  /** Initial share of the container, 0..1. Normalized across siblings. */
  defaultSize: number;
  /** Hard floor in pixels. The pane will not shrink below this. */
  minSize?: number;
  /** When false, the pane holds its pixel size as the container resizes. */
  resizable?: boolean;
}

export interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  panes: SplitPaneChild[];
  /** When set, sizes persist to localStorage under this key. */
  storageKey?: string;
  className?: string;
}

const DEFAULT_MIN_SIZE = 120;
const DIVIDER_THICKNESS = 1;
/** Invisible grab area around the 1px divider — Fitts's law, not decoration. */
const DIVIDER_HIT_AREA = 9;

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((size) => size / total);
}

function readStoredSizes(storageKey: string | undefined, count: number): number[] | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`cutaway.split.${storageKey}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== count) return null;
    if (!parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) return null;
    return normalize(parsed as number[]);
  } catch {
    // Corrupt or unreadable storage must never block the editor from opening.
    return null;
  }
}

/**
 * A resizable split container.
 *
 * Sizes are held as **fractions**, not pixels, so panes keep their proportions
 * when the window resizes — the behaviour users expect from Figma and Premiere.
 * Pixel minimums are enforced at drag time against the measured container.
 *
 * Nest these to build arbitrary dock layouts; a horizontal split whose middle
 * pane is a vertical split is the entire editor shell.
 */
export function SplitPane({ direction, panes, storageKey, className }: SplitPaneProps) {
  const isHorizontal = direction === "horizontal";
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<number[]>(() =>
    normalize(panes.map((pane) => pane.defaultSize)),
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Storage is read after mount rather than during render: touching
  // localStorage in the initial state would produce different HTML on the
  // server and client, and hydration would fail.
  useLayoutEffect(() => {
    const stored = readStoredSizes(storageKey, panes.length);
    if (stored) setSizes(stored);
  }, [storageKey, panes.length]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined" || draggingIndex !== null) return;
    try {
      window.localStorage.setItem(`cutaway.split.${storageKey}`, JSON.stringify(sizes));
    } catch {
      // Private browsing or a full quota — losing layout memory is acceptable.
    }
  }, [sizes, storageKey, draggingIndex]);

  const containerExtent = useCallback((): number => {
    const element = containerRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return isHorizontal ? rect.width : rect.height;
  }, [isHorizontal]);

  /**
   * Resizes the two panes adjacent to a divider, leaving all others untouched.
   *
   * Only the neighbours move because propagating a drag through the whole row
   * makes fine adjustment impossible — nudging one edge would shuffle the
   * entire layout.
   */
  const applyDelta = useCallback(
    (dividerIndex: number, deltaPx: number) => {
      const extent = containerExtent();
      if (extent <= 0) return;

      setSizes((current) => {
        const next = [...current];
        const before = next[dividerIndex] ?? 0;
        const after = next[dividerIndex + 1] ?? 0;

        const minBefore = (panes[dividerIndex]?.minSize ?? DEFAULT_MIN_SIZE) / extent;
        const minAfter = (panes[dividerIndex + 1]?.minSize ?? DEFAULT_MIN_SIZE) / extent;

        const deltaFraction = deltaPx / extent;
        // Clamp against both neighbours so neither can be pushed under its
        // minimum, and so the pair's combined size is exactly conserved.
        const clamped = Math.max(-(before - minBefore), Math.min(deltaFraction, after - minAfter));

        next[dividerIndex] = before + clamped;
        next[dividerIndex + 1] = after - clamped;
        return next;
      });
    },
    [containerExtent, panes],
  );

  const handlePointerDown = useCallback(
    (dividerIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDraggingIndex(dividerIndex);

      let lastPosition = isHorizontal ? event.clientX : event.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const position = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        applyDelta(dividerIndex, position - lastPosition);
        lastPosition = position;
      };

      const handleUp = () => {
        setDraggingIndex(null);
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
      };

      // Listeners go on the captured element, not on window: pointer capture
      // guarantees they keep firing even when the cursor outruns the divider or
      // crosses an iframe, which a window listener does not.
      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [applyDelta, isHorizontal],
  );

  /** Keyboard resizing — dividers are focusable, so this is not optional. */
  const handleKeyDown = useCallback(
    (dividerIndex: number, event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 8;
      const decreaseKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
      const increaseKey = isHorizontal ? "ArrowRight" : "ArrowDown";

      if (event.key === decreaseKey) {
        event.preventDefault();
        applyDelta(dividerIndex, -step);
      } else if (event.key === increaseKey) {
        event.preventDefault();
        applyDelta(dividerIndex, step);
      }
    },
    [applyDelta, isHorizontal],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full overflow-hidden",
        isHorizontal ? "flex-row" : "flex-col",
        className,
      )}
    >
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          <div
            className="relative min-h-0 min-w-0 overflow-hidden"
            style={{ flexGrow: sizes[index] ?? 1, flexShrink: 1, flexBasis: 0 }}
          >
            {pane.content}
          </div>

          {index < panes.length - 1 && (
            <div
              role="separator"
              tabIndex={0}
              aria-orientation={isHorizontal ? "vertical" : "horizontal"}
              aria-label={`Resize ${pane.id}`}
              onPointerDown={(event) => handlePointerDown(index, event)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              className={cn(
                "bg-border-subtle duration-fast relative z-10 shrink-0 transition-colors",
                "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                draggingIndex === index && "bg-accent",
                isHorizontal ? "cursor-col-resize" : "cursor-row-resize",
              )}
              style={isHorizontal ? { width: DIVIDER_THICKNESS } : { height: DIVIDER_THICKNESS }}
            >
              {/* Widens the grab target without widening the visible line. */}
              <span
                aria-hidden
                className="absolute"
                style={
                  isHorizontal
                    ? {
                        top: 0,
                        bottom: 0,
                        left: -(DIVIDER_HIT_AREA - DIVIDER_THICKNESS) / 2,
                        width: DIVIDER_HIT_AREA,
                      }
                    : {
                        left: 0,
                        right: 0,
                        top: -(DIVIDER_HIT_AREA - DIVIDER_THICKNESS) / 2,
                        height: DIVIDER_HIT_AREA,
                      }
                }
              />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
