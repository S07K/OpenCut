"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import type { Clip } from "@cutaway/types";
import { cn } from "@cutaway/ui";
import { useEditorStore } from "@/state/editorStore";
import { ANIMATION_PRESETS } from "./presets";
import { applicablePresets, applyPreset } from "./applyPreset";

/**
 * One-click animation presets for the selected clip.
 *
 * Applying a preset runs through the same `updateClip` seam as every other
 * edit, so it is a single undo step and autosaves like anything else. Presets
 * are grouped by category so entrances, exits, and emphasis read as distinct
 * intents rather than one long list.
 */
export function PresetPicker({ clip }: { clip: Clip }) {
  const updateClip = useEditorStore((state) => state.updateClip);

  const presets = useMemo(() => applicablePresets(clip, ANIMATION_PRESETS), [clip]);
  if (presets.length === 0) return null;

  const groups = [
    { label: "In", category: "in" as const },
    { label: "Out", category: "out" as const },
    { label: "Emphasis", category: "emphasis" as const },
  ].filter((group) => presets.some((preset) => preset.category === group.category));

  return (
    <section>
      <h3 className="text-2xs text-text-tertiary mb-1 flex items-center gap-1 font-medium tracking-wide uppercase">
        <Sparkles size={11} />
        Animate
      </h3>

      <div className="flex flex-col gap-1.5">
        {groups.map((group) => (
          <div key={group.category} className="flex flex-wrap gap-1">
            {presets
              .filter((preset) => preset.category === group.category)
              .map((preset) => (
                <button
                  key={preset.id}
                  onClick={() =>
                    updateClip(
                      clip.id,
                      (target) => applyPreset(target, preset),
                      `Apply ${preset.name}`,
                    )
                  }
                  className={cn(
                    "border-border-default bg-surface-raised text-2xs text-text-secondary rounded-sm border px-2 py-1",
                    "duration-fast hover:border-accent hover:text-text-primary transition-colors",
                    "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                  )}
                >
                  {preset.name}
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
