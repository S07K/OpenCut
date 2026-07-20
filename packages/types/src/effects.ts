/**
 * Effects and transitions.
 *
 * Note what is *absent* here: a union of built-in effect names. Effects are
 * open-world — an instance only references a registry key and a bag of
 * parameters. A plugin-provided blur and a core blur are indistinguishable to
 * the document, which is the property that makes the plugin system real rather
 * than decorative.
 */

import type { Animatable } from "./animation";
import type { Id } from "./primitives";

/** Values an effect parameter may hold. Constrained so it stays serializable. */
export type EffectParamValue = number | string | boolean | number[];

/** An effect applied to an object or track. */
export interface EffectInstance {
  /** Unique per-instance id, so the same effect can be applied twice. */
  id: Id;
  /** Registry key, e.g. `core.blur.gaussian` or `com.acme.glitch`. */
  effectId: string;
  enabled: boolean;
  params: Record<string, Animatable<EffectParamValue>>;
}

/** Declares an effect's parameters so the UI can build a panel automatically. */
export interface EffectParamSchema {
  key: string;
  label: string;
  type: "number" | "range" | "color" | "boolean" | "select" | "point";
  defaultValue: EffectParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}

export interface EffectDefinition {
  effectId: string;
  name: string;
  category: string;
  params: EffectParamSchema[];
}

/** A transition sits *between* two clips on the same track. */
export interface TransitionInstance {
  id: Id;
  /** Registry key, e.g. `core.transition.crossfade`. */
  transitionId: string;
  durationFrames: number;
  params: Record<string, Animatable<EffectParamValue>>;
}
