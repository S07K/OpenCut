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
];
