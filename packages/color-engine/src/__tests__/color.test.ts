import { describe, expect, it } from "vitest";
import { staticValue } from "@opencut/types";
import type { ColorGrade } from "@opencut/types";
import { isNeutralGrade, resolveGrade } from "../evaluate";
import { COLOR_GRADE_PRESETS, getColorGradePreset } from "../presets";

/** A fully-neutral grade, matching createColorGrade's defaults. */
function neutralGrade(overrides: Partial<Record<string, unknown>> = {}): ColorGrade {
  const wheel = () => ({ offset: staticValue({ x: 0, y: 0 }), level: staticValue(0) });
  return {
    enabled: true,
    brightness: staticValue(0),
    contrast: staticValue(0),
    exposure: staticValue(0),
    shadows: staticValue(0),
    highlights: staticValue(0),
    whites: staticValue(0),
    blacks: staticValue(0),
    temperature: staticValue(0),
    tint: staticValue(0),
    saturation: staticValue(0),
    vibrance: staticValue(0),
    curves: {
      master: [],
      red: [],
      green: [],
      blue: [],
    },
    wheels: { lift: wheel(), gamma: wheel(), gain: wheel() },
    vignette: { amount: staticValue(0), radius: staticValue(0.7), softness: staticValue(0.5) },
    grain: { amount: staticValue(0), size: staticValue(1) },
    ...(overrides as object),
  } as ColorGrade;
}

describe("resolveGrade", () => {
  it("resolves every field to a plain number", () => {
    const grade = neutralGrade({ contrast: staticValue(0.5), temperature: staticValue(-0.3) });
    const resolved = resolveGrade(grade, 0);

    expect(resolved.contrast).toBe(0.5);
    expect(resolved.temperature).toBe(-0.3);
    expect(resolved.wheels.lift.level).toBe(0);
    expect(resolved.vignette.radius).toBe(0.7);
  });

  it("resolves animated fields at the frame", () => {
    const grade = neutralGrade({
      exposure: {
        type: "animated",
        keyframes: [
          { frame: 0, value: 0, easing: { kind: "linear" } },
          { frame: 10, value: 1, easing: { kind: "linear" } },
        ],
      },
    });

    expect(resolveGrade(grade, 5).exposure).toBeCloseTo(0.5);
  });
});

describe("isNeutralGrade", () => {
  it("is true for an unmodified grade", () => {
    expect(isNeutralGrade(resolveGrade(neutralGrade(), 0))).toBe(true);
  });

  it("is false once any tonal field moves", () => {
    expect(isNeutralGrade(resolveGrade(neutralGrade({ brightness: staticValue(0.1) }), 0))).toBe(
      false,
    );
  });

  it("is false when a wheel is offset", () => {
    const grade = neutralGrade();
    grade.wheels.gain.level = staticValue(0.2);
    expect(isNeutralGrade(resolveGrade(grade, 0))).toBe(false);
  });

  it("is false when vignette or grain is applied", () => {
    expect(
      isNeutralGrade(
        resolveGrade(
          neutralGrade({
            vignette: {
              amount: staticValue(0.3),
              radius: staticValue(0.7),
              softness: staticValue(0.5),
            },
          }),
          0,
        ),
      ),
    ).toBe(false);
  });

  it("ignores vignette radius/softness when amount is zero", () => {
    // Radius defaults to 0.7 but with amount 0 the grade is still a no-op.
    expect(isNeutralGrade(resolveGrade(neutralGrade(), 0))).toBe(true);
  });
});

describe("colour grade presets", () => {
  it("ships named looks", () => {
    const names = COLOR_GRADE_PRESETS.map((p) => p.name);
    expect(names).toContain("Cinematic");
    expect(names).toContain("B&W");
  });

  it("fully desaturates for B&W", () => {
    expect(getColorGradePreset("core.grade.bw")?.values.saturation).toBe(-1);
  });

  it("returns null for an unknown id", () => {
    expect(getColorGradePreset("nope")).toBeNull();
  });

  it("serializes losslessly (presets are data)", () => {
    const preset = COLOR_GRADE_PRESETS[0]!;
    expect(JSON.parse(JSON.stringify(preset))).toEqual(preset);
  });
});
