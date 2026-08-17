/**
 * Resolving effect instances to flat, frame-fixed parameter values.
 *
 * Every effect parameter is Animatable, so at a given frame it has one concrete
 * value. This turns the clip's effect stack into plain data the compositor can
 * apply without touching the animation system — the same value the exporter
 * sees, so an effect previews and exports identically. Disabled effects drop
 * out here, keeping the renderer branchless.
 */

import type {
  Animatable,
  EffectDefinition,
  EffectInstance,
  EffectParamValue,
  Frame,
} from "@cutaway/types";
import { evaluate } from "@cutaway/animation-engine";

/** An effect flattened for one frame: an id plus concrete parameter values. */
export interface ResolvedEffect {
  effectId: string;
  params: Record<string, EffectParamValue>;
}

/** Resolves a clip's effect stack at `frame`, in order, skipping disabled effects. */
export function resolveEffects(effects: readonly EffectInstance[], frame: Frame): ResolvedEffect[] {
  const resolved: ResolvedEffect[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    const params: Record<string, EffectParamValue> = {};
    for (const [key, animatable] of Object.entries(effect.params)) {
      params[key] = evaluate(animatable as Animatable<EffectParamValue>, frame);
    }
    resolved.push({ effectId: effect.effectId, params });
  }
  return resolved;
}

/**
 * Builds the default parameter map for a definition, each wrapped as a static
 * Animatable. The UI pairs this with an id to create a fresh EffectInstance;
 * keeping it here means an instance always starts consistent with its schema.
 */
export function defaultEffectParams(
  definition: EffectDefinition,
): Record<string, Animatable<EffectParamValue>> {
  const params: Record<string, Animatable<EffectParamValue>> = {};
  for (const schema of definition.params) {
    params[schema.key] = { type: "static", value: schema.defaultValue };
  }
  return params;
}
