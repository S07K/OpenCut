/**
 * Core effects shipped with the editor.
 *
 * These are just data — the same shape a plugin would register. Parameters are
 * normalised to 0..1 wherever it reads naturally, so every slider in the
 * auto-built panel behaves consistently and the compositor owns the mapping from
 * a normalised value to renderer units (pixel radius, etc.). Only effects the
 * compositor can actually draw live here; adding a definition without a matching
 * renderer branch would show a control that does nothing.
 */

import type { EffectDefinition } from "@cutaway/types";

export const EFFECT_BLUR = "core.blur.gaussian";
export const EFFECT_NOISE = "core.stylize.noise";
export const EFFECT_CHROMA = "core.key.chroma";
export const EFFECT_SEPIA = "core.color.sepia";
export const EFFECT_GRAYSCALE = "core.color.grayscale";
export const EFFECT_INVERT = "core.color.invert";
export const EFFECT_HUE = "core.color.hue";

/** An "amount" range param (0..1), shared by the blend-strength colour effects. */
const amountParam = {
  key: "amount",
  label: "Amount",
  type: "range" as const,
  defaultValue: 1,
  min: 0,
  max: 1,
  step: 0.01,
};

export const BUILTIN_EFFECTS: EffectDefinition[] = [
  {
    effectId: EFFECT_BLUR,
    name: "Gaussian Blur",
    category: "Blur",
    params: [
      {
        key: "strength",
        label: "Strength",
        type: "range",
        defaultValue: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    effectId: EFFECT_NOISE,
    name: "Noise",
    category: "Stylize",
    params: [
      {
        key: "amount",
        label: "Amount",
        type: "range",
        defaultValue: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    effectId: EFFECT_CHROMA,
    name: "Chroma Key",
    category: "Keying",
    params: [
      { key: "color", label: "Key color", type: "color", defaultValue: "#00ff00" },
      {
        key: "similarity",
        label: "Similarity",
        type: "range",
        defaultValue: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "smoothness",
        label: "Smoothness",
        type: "range",
        defaultValue: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  { effectId: EFFECT_SEPIA, name: "Sepia", category: "Color", params: [amountParam] },
  { effectId: EFFECT_GRAYSCALE, name: "Grayscale", category: "Color", params: [amountParam] },
  { effectId: EFFECT_INVERT, name: "Invert", category: "Color", params: [amountParam] },
  {
    effectId: EFFECT_HUE,
    name: "Hue Rotate",
    category: "Color",
    params: [
      {
        key: "degrees",
        label: "Degrees",
        type: "range",
        defaultValue: 0,
        min: -180,
        max: 180,
        step: 1,
      },
    ],
  },
];
