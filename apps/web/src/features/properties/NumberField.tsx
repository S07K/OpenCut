"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@opencut/ui";

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Called once when a scrub or type edit finishes, to seal the undo step. */
  onCommit?: () => void;
  step?: number;
  min?: number;
  max?: number;
  /** Compact prefix such as "X" or "R°". */
  label?: string;
}

/**
 * A number field that also scrubs — drag left/right on the label to change the
 * value, the interaction every motion tool uses because reaching for the
 * keyboard for each nudge is death by a thousand cuts.
 *
 * Local text state is kept while typing so a partial entry ("1." or "-") does
 * not get parsed to NaN and snapped away mid-keystroke; the parsed value is
 * pushed up only when it is valid.
 */
export function NumberField({
  value,
  onChange,
  onCommit,
  step = 1,
  min,
  max,
  label,
}: NumberFieldProps) {
  const [text, setText] = useState(() => format(value));
  const [editing, setEditing] = useState(false);
  const scrubbing = useRef(false);

  // React's sanctioned "adjust state when a prop changes" pattern: compare the
  // incoming value against the last one in state and reconcile during render,
  // which avoids the extra pass an effect would cost. While the user is
  // mid-edit their text is left alone — clobbering it would be maddening.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (!editing) setText(format(value));
  }

  const clamp = useCallback(
    (next: number) => {
      let result = next;
      if (min !== undefined) result = Math.max(min, result);
      if (max !== undefined) result = Math.min(max, result);
      return result;
    },
    [min, max],
  );

  const handleScrub = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      scrubbing.current = true;

      let lastX = event.clientX;
      let current = value;

      const onMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - lastX;
        lastX = moveEvent.clientX;
        // Fine control with Shift, matching Figma and After Effects.
        const multiplier = moveEvent.shiftKey ? 0.1 : 1;
        current = clamp(current + deltaX * step * multiplier);
        onChange(current);
      };

      const onUp = () => {
        scrubbing.current = false;
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        onCommit?.();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [value, step, clamp, onChange, onCommit],
  );

  // Guards against committing twice when Enter both commits directly and then
  // fires a blur. Reset whenever the field is focused for a fresh edit.
  const committed = useRef(false);

  const commitText = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);

    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) {
      const clamped = clamp(parsed);
      onChange(clamped);
      setText(format(clamped));
      onCommit?.();
    } else {
      setText(format(value));
    }
  }, [text, value, clamp, onChange, onCommit]);

  return (
    <div className="bg-surface-input flex h-6 items-center overflow-hidden rounded-xs">
      {label && (
        <span
          onPointerDown={handleScrub}
          className="text-2xs text-text-tertiary hover:text-accent grid h-full w-5 shrink-0 cursor-ew-resize place-items-center select-none"
        >
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => {
          committed.current = false;
          setEditing(true);
        }}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Commit directly rather than relying on the blur event, then
            // release focus. Enter must always save, even where a synthetic
            // blur would not fire.
            commitText();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            committed.current = true; // Suppress the blur commit — Escape reverts.
            setText(format(value));
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "tabular text-text-primary h-full w-full min-w-0 bg-transparent px-1.5 text-xs",
          "focus:outline-none",
        )}
      />
    </div>
  );
}

/** Trims trailing zeros so "1.00" reads as "1" but "1.5" survives. */
function format(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.parseFloat(value.toFixed(3)).toString();
}
