"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { Clip, EffectDefinition, EffectInstance, EffectParamValue } from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import { evaluate } from "@cutaway/animation-engine";
import { defaultEffectParams, effectRegistry } from "@cutaway/effects-engine";
import { createId } from "@cutaway/utils";
import { IconButton, cn } from "@cutaway/ui";
import { useEditorStore } from "@/state/editorStore";
import { NumberField } from "@/features/properties/NumberField";

/**
 * Effect stack for the selected clip.
 *
 * The panel is built entirely from the registry: the add menu lists whatever is
 * registered (core or plugin), and each instance's controls are generated from
 * its definition's parameter schema. Nothing here names a concrete effect, so a
 * plugin effect gets a working UI for free. All edits flow through the generic
 * updateClip seam, so effects undo and autosave like any clip edit.
 */
export function EffectsPanel() {
  const selectedIds = useEditorStore((state) => state.selectedClipIds);
  const clip = useEditorStore((state) =>
    selectedIds.length === 1 ? state.project.entities.clips[selectedIds[0]!] : undefined,
  );
  const playhead = useEditorStore((state) => state.playhead);
  const updateClip = useEditorStore((state) => state.updateClip);
  const endGesture = useEditorStore((state) => state.endGesture);

  if (!clip) return <p className="text-text-tertiary p-3 text-xs">Select a clip to add effects.</p>;
  if (clip.content.kind === "audio") {
    return <p className="text-text-tertiary p-3 text-xs">Audio clips cannot take effects.</p>;
  }

  const patchEffects = (
    mutate: (effects: EffectInstance[]) => EffectInstance[],
    label: string,
    mergeKey?: string,
  ) => updateClip(clip.id, (c: Clip) => ({ ...c, effects: mutate(c.effects) }), label, mergeKey);

  const addEffect = (definition: EffectDefinition) =>
    patchEffects(
      (effects) => [
        ...effects,
        {
          id: createId("fx"),
          effectId: definition.effectId,
          enabled: true,
          params: defaultEffectParams(definition),
        },
      ],
      `Add ${definition.name}`,
    );

  const removeEffect = (id: string) =>
    patchEffects((effects) => effects.filter((e) => e.id !== id), "Remove effect");

  const toggleEffect = (id: string) =>
    patchEffects(
      (effects) => effects.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
      "Toggle effect",
    );

  const setParam = (id: string, key: string, value: EffectParamValue) =>
    patchEffects(
      (effects) =>
        effects.map((e) =>
          e.id === id ? { ...e, params: { ...e.params, [key]: staticValue(value) } } : e,
        ),
      "Adjust effect",
      `fx:${id}:${key}`,
    );

  return (
    <div className="flex flex-col gap-3 p-3">
      <section>
        <h3 className="text-2xs text-text-tertiary mb-1 font-medium tracking-wide uppercase">
          Add effect
        </h3>
        <div className="flex flex-wrap gap-1">
          {effectRegistry.list().map((definition) => (
            <button
              key={definition.effectId}
              onClick={() => addEffect(definition)}
              className={cn(
                "border-border-default bg-surface-raised text-2xs text-text-secondary rounded-sm border px-2 py-1",
                "duration-fast hover:border-accent hover:text-text-primary transition-colors",
              )}
            >
              {definition.name}
            </button>
          ))}
        </div>
      </section>

      {clip.effects.length === 0 ? (
        <p className="text-text-tertiary text-2xs">No effects. Add one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clip.effects.map((effect) => {
            const definition = effectRegistry.get(effect.effectId);
            return (
              <li
                key={effect.id}
                className="border-border-subtle bg-surface-raised flex flex-col gap-1.5 rounded-sm border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-2xs min-w-0 flex-1 truncate",
                      effect.enabled ? "text-text-primary" : "text-text-tertiary",
                    )}
                  >
                    {definition?.name ?? effect.effectId}
                  </span>
                  <IconButton
                    size="sm"
                    label={effect.enabled ? "Disable effect" : "Enable effect"}
                    active={!effect.enabled}
                    onClick={() => toggleEffect(effect.id)}
                  >
                    {effect.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Remove effect"
                    onClick={() => removeEffect(effect.id)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>

                {/* An effect whose plugin is missing shows only its stored id, no
                    controls — the document is intact and reappears with the plugin. */}
                {definition?.params.map((schema) => {
                  const animatable = effect.params[schema.key];
                  if (!animatable) return null;
                  const value = evaluate(animatable, playhead);
                  if (typeof value !== "number") return null;
                  return (
                    <div key={schema.key} className="flex items-center gap-1.5 py-0.5">
                      <span className="text-2xs text-text-secondary w-20 shrink-0">
                        {schema.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <NumberField
                          value={value}
                          step={schema.step ?? 0.01}
                          min={schema.min}
                          max={schema.max}
                          onChange={(v) => setParam(effect.id, schema.key, v)}
                          onCommit={endGesture}
                        />
                      </div>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
