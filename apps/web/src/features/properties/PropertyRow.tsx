"use client";

import { Diamond } from "lucide-react";
import type { Clip, Vec2 } from "@opencut/types";
import { cn } from "@opencut/ui";
import { NumberField } from "./NumberField";
import type { PropertyDescriptor } from "./propertySchema";
import type { ClipPropertyApi } from "./useClipProperties";

interface PropertyRowProps {
  clip: Clip;
  descriptor: PropertyDescriptor;
  api: ClipPropertyApi;
}

/**
 * One editable property: its label, value field(s), and a keyframe toggle.
 *
 * The keyframe diamond is the heart of the animation UX. Filled means a
 * keyframe sits on the current frame; an outline with the accent tint means the
 * property is animated but this frame falls between keyframes; empty means the
 * property is a constant. This is the After Effects / Premiere convention, so
 * it needs no explanation to the audience.
 */
export function PropertyRow({ clip, descriptor, api }: PropertyRowProps) {
  const value = api.valueAt(clip, descriptor);
  const keyframedHere = api.isKeyframedHere(clip, descriptor);
  const animated = api.isAnimated(clip, descriptor);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <button
        aria-label={`Toggle ${descriptor.label} keyframe`}
        aria-pressed={keyframedHere}
        onClick={() => api.toggleKeyframe(clip.id, descriptor)}
        className={cn(
          "duration-fast grid h-5 w-5 shrink-0 place-items-center rounded-xs transition-colors",
          "hover:bg-surface-raised focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
          keyframedHere ? "text-accent" : animated ? "text-accent/60" : "text-text-tertiary",
        )}
      >
        <Diamond size={11} fill={keyframedHere ? "currentColor" : "none"} />
      </button>

      <span className="text-2xs text-text-secondary w-20 shrink-0 truncate">
        {descriptor.label}
      </span>

      <div className="flex min-w-0 flex-1 gap-1">{renderFields(clip, descriptor, value, api)}</div>
    </div>
  );
}

function renderFields(
  clip: Clip,
  descriptor: PropertyDescriptor,
  value: unknown,
  api: ClipPropertyApi,
) {
  const commit = () => api.endEdit();

  if (descriptor.kind === "point") {
    const point = (value as Vec2 | null) ?? { x: 0, y: 0 };
    return (
      <>
        <NumberField
          label="X"
          value={point.x}
          step={descriptor.step}
          onChange={(x) => api.setValue(clip.id, descriptor, { ...point, x })}
          onCommit={commit}
        />
        <NumberField
          label="Y"
          value={point.y}
          step={descriptor.step}
          onChange={(y) => api.setValue(clip.id, descriptor, { ...point, y })}
          onCommit={commit}
        />
      </>
    );
  }

  if (descriptor.kind === "color") {
    const color = (value as string | null) ?? "#ffffff";
    return (
      <label className="bg-surface-input flex h-6 w-full items-center gap-1.5 rounded-xs px-1.5">
        <input
          type="color"
          value={color}
          onChange={(event) => api.setValue(clip.id, descriptor, event.target.value)}
          onBlur={commit}
          className="h-4 w-4 shrink-0 cursor-pointer rounded-xs border-0 bg-transparent p-0"
        />
        <span className="tabular text-2xs text-text-primary truncate uppercase">{color}</span>
      </label>
    );
  }

  const numeric = typeof value === "number" ? value : 0;
  return (
    <NumberField
      label={descriptor.kind === "angle" ? "°" : undefined}
      value={numeric}
      step={descriptor.step}
      min={descriptor.min}
      max={descriptor.max}
      onChange={(next) => api.setValue(clip.id, descriptor, next)}
      onCommit={commit}
    />
  );
}
