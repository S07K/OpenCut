import { describe, expect, it } from "vitest";
import type { EffectDefinition, EffectInstance } from "@opencut/types";
import { EffectRegistry } from "../registry";
import { BUILTIN_EFFECTS, EFFECT_BLUR } from "../builtins";
import { defaultEffectParams, resolveEffects } from "../resolve";
import { effectRegistry } from "../index";

const glitch: EffectDefinition = {
  effectId: "com.acme.glitch",
  name: "Glitch",
  category: "Stylize",
  params: [{ key: "intensity", label: "Intensity", type: "range", defaultValue: 0.5 }],
};

describe("EffectRegistry", () => {
  it("registers and looks up a definition by id", () => {
    const registry = new EffectRegistry();
    registry.register(glitch);

    expect(registry.get("com.acme.glitch")).toBe(glitch);
    expect(registry.has("com.acme.glitch")).toBe(true);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    expect(new EffectRegistry().get("missing.plugin.effect")).toBeUndefined();
  });

  it("treats a plugin effect the same as a core effect (open-world)", () => {
    const registry = new EffectRegistry();
    registry.registerAll(BUILTIN_EFFECTS);
    registry.register(glitch);

    const ids = registry.list().map((d) => d.effectId);
    expect(ids).toContain(EFFECT_BLUR);
    expect(ids).toContain("com.acme.glitch");
  });

  it("lets a later registration override an id", () => {
    const registry = new EffectRegistry();
    registry.register(glitch);
    const replacement = { ...glitch, name: "Glitch 2" };
    registry.register(replacement);

    expect(registry.get("com.acme.glitch")?.name).toBe("Glitch 2");
    expect(registry.list()).toHaveLength(1);
  });

  it("groups definitions by category", () => {
    const registry = new EffectRegistry();
    registry.registerAll(BUILTIN_EFFECTS);
    const groups = registry.byCategory();

    expect(groups.get("Blur")?.map((d) => d.effectId)).toContain(EFFECT_BLUR);
    expect(groups.get("Stylize")).toBeDefined();
  });
});

describe("shared registry", () => {
  it("comes pre-seeded with the built-in effects", () => {
    expect(effectRegistry.get(EFFECT_BLUR)).toBeDefined();
  });
});

describe("defaultEffectParams", () => {
  it("builds a static param map from the schema defaults", () => {
    const params = defaultEffectParams(glitch);
    expect(params.intensity).toEqual({ type: "static", value: 0.5 });
  });
});

describe("resolveEffects", () => {
  const blur = (enabled: boolean, strength: number): EffectInstance => ({
    id: "e1",
    effectId: EFFECT_BLUR,
    enabled,
    params: { strength: { type: "static", value: strength } },
  });

  it("flattens enabled effects to concrete values at a frame", () => {
    const resolved = resolveEffects([blur(true, 0.4)], 0);
    expect(resolved).toEqual([{ effectId: EFFECT_BLUR, params: { strength: 0.4 } }]);
  });

  it("drops disabled effects", () => {
    expect(resolveEffects([blur(false, 0.4)], 0)).toEqual([]);
  });

  it("preserves stack order", () => {
    const noise: EffectInstance = {
      id: "e2",
      effectId: "core.stylize.noise",
      enabled: true,
      params: { amount: { type: "static", value: 0.2 } },
    };
    const order = resolveEffects([blur(true, 0.1), noise], 0).map((e) => e.effectId);
    expect(order).toEqual([EFFECT_BLUR, "core.stylize.noise"]);
  });

  it("evaluates an animated parameter at the frame", () => {
    const animated: EffectInstance = {
      id: "e3",
      effectId: EFFECT_BLUR,
      enabled: true,
      params: {
        strength: {
          type: "animated",
          keyframes: [
            { frame: 0, value: 0, easing: { kind: "linear" } },
            { frame: 10, value: 1, easing: { kind: "linear" } },
          ],
        },
      },
    };
    expect(resolveEffects([animated], 5)[0]!.params.strength).toBeCloseTo(0.5);
  });
});
