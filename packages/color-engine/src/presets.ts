/**
 * Colour grade presets — plain data, applied by merging into a clip's grade.
 *
 * Each preset is a partial set of the tonal/chromatic values (the animatable
 * fields become static values when applied). Named looks are starting points;
 * every value stays editable afterward. Community looks ship as JSON.
 */

export interface ColorGradePreset {
  id: string;
  name: string;
  /** Static values, in the document's -1..1 "0 = unchanged" convention. */
  values: Partial<{
    brightness: number;
    contrast: number;
    exposure: number;
    shadows: number;
    highlights: number;
    whites: number;
    blacks: number;
    temperature: number;
    tint: number;
    saturation: number;
    vibrance: number;
  }>;
}

export const COLOR_GRADE_PRESETS: ColorGradePreset[] = [
  {
    id: "core.grade.warm",
    name: "Warm",
    values: { temperature: 0.25, saturation: 0.1, highlights: 0.08 },
  },
  {
    id: "core.grade.cool",
    name: "Cool",
    values: { temperature: -0.25, tint: -0.05, shadows: -0.06 },
  },
  {
    id: "core.grade.cinematic",
    name: "Cinematic",
    // Lifted, desaturated shadows and pulled highlights — the teal-and-orange
    // adjacent "film" look without a LUT.
    values: {
      contrast: 0.18,
      saturation: -0.12,
      shadows: 0.1,
      highlights: -0.1,
      temperature: 0.08,
    },
  },
  {
    id: "core.grade.punchy",
    name: "Punchy",
    values: { contrast: 0.28, vibrance: 0.3, blacks: -0.1 },
  },
  {
    id: "core.grade.bw",
    name: "B&W",
    // Fully desaturated with a slight contrast bump.
    values: { saturation: -1, contrast: 0.12 },
  },
  {
    id: "core.grade.faded",
    name: "Faded",
    // Raised blacks, gentle desaturation — the muted matte look.
    values: { blacks: 0.14, contrast: -0.1, saturation: -0.18 },
  },
];

export function getColorGradePreset(id: string): ColorGradePreset | null {
  return COLOR_GRADE_PRESETS.find((preset) => preset.id === id) ?? null;
}
