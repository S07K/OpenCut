"use client";

import type { Clip, ColorGrade } from "@opencut/types";
import { staticValue } from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";
import { COLOR_GRADE_PRESETS, type ColorGradePreset } from "@opencut/color-engine";
import { createColorGrade } from "@opencut/utils";
import { cn } from "@opencut/ui";
import { useEditorStore } from "@/state/editorStore";
import { NumberField } from "@/features/properties/NumberField";

/**
 * Colour grading panel for the selected clip.
 *
 * Tonal and chromatic controls edit the clip's ColorGrade through the generic
 * updateClip seam — the same path as every other clip edit, so grades undo and
 * autosave like anything else. Sliders read/write static values at the playhead
 * via the animation-engine, so a grade authored here is a plain constant unless
 * later keyframed. A grade is created on first touch, keeping ungraded clips
 * free of a redundant neutral grade in the document.
 */

interface GradeField {
  key: keyof Pick<
    ColorGrade,
    | "exposure"
    | "contrast"
    | "saturation"
    | "brightness"
    | "temperature"
    | "tint"
    | "vibrance"
    | "shadows"
    | "highlights"
  >;
  label: string;
}

const FIELDS: GradeField[] = [
  { key: "exposure", label: "Exposure" },
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "vibrance", label: "Vibrance" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
  { key: "shadows", label: "Shadows" },
  { key: "highlights", label: "Highlights" },
];

export function ColorPanel() {
  const selectedIds = useEditorStore((state) => state.selectedClipIds);
  const clip = useEditorStore((state) =>
    selectedIds.length === 1 ? state.project.entities.clips[selectedIds[0]!] : undefined,
  );
  const playhead = useEditorStore((state) => state.playhead);
  const updateClip = useEditorStore((state) => state.updateClip);
  const endGesture = useEditorStore((state) => state.endGesture);

  if (!clip) return <p className="text-text-tertiary p-3 text-xs">Select a clip to grade it.</p>;
  if (clip.content.kind === "audio") {
    return <p className="text-text-tertiary p-3 text-xs">Audio clips cannot be graded.</p>;
  }

  const grade = clip.grade;

  const withGrade = (mutate: (g: ColorGrade) => ColorGrade): ((c: Clip) => Clip) => {
    return (c) => {
      // Materialise a grade on first touch, enabled so it actually renders.
      const base = c.grade ?? { ...createColorGrade(), enabled: true };
      return { ...c, grade: mutate({ ...base, enabled: true }) };
    };
  };

  const setField = (key: GradeField["key"], value: number) =>
    updateClip(
      clip.id,
      withGrade((g) => ({ ...g, [key]: staticValue(value) })),
      "Adjust colour",
      `grade:${clip.id}:${key}`,
    );

  const applyPreset = (preset: ColorGradePreset) =>
    updateClip(
      clip.id,
      withGrade((g) => {
        const next = { ...g };
        for (const [key, value] of Object.entries(preset.values)) {
          (next as Record<string, unknown>)[key] = staticValue(value);
        }
        return next;
      }),
      `Apply ${preset.name} grade`,
    );

  const reset = () => updateClip(clip.id, (c) => ({ ...c, grade: null }), "Reset colour");

  return (
    <div className="flex flex-col gap-3 p-3">
      <section>
        <h3 className="text-2xs text-text-tertiary mb-1 font-medium tracking-wide uppercase">
          Looks
        </h3>
        <div className="flex flex-wrap gap-1">
          {COLOR_GRADE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className={cn(
                "border-border-default bg-surface-raised text-2xs text-text-secondary rounded-sm border px-2 py-1",
                "duration-fast hover:border-accent hover:text-text-primary transition-colors",
              )}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h3 className="text-2xs text-text-tertiary font-medium tracking-wide uppercase">
            Adjust
          </h3>
          {grade && (
            <button onClick={reset} className="text-2xs text-text-tertiary hover:text-danger">
              Reset
            </button>
          )}
        </div>

        {FIELDS.map((field) => {
          const value = grade ? (evaluate(grade[field.key], playhead) as number) : 0;
          return (
            <div key={field.key} className="flex items-center gap-1.5 py-0.5">
              <span className="text-2xs text-text-secondary w-20 shrink-0">{field.label}</span>
              <div className="min-w-0 flex-1">
                <NumberField
                  value={value}
                  step={0.01}
                  min={-1}
                  max={1}
                  onChange={(v) => setField(field.key, v)}
                  onCommit={endGesture}
                />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
