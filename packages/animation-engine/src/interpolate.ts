/**
 * Value interpolation.
 *
 * Keyframes can hold numbers, points, colors, or arbitrary objects. Rather than
 * requiring each property to declare its type, interpolation dispatches on the
 * runtime shape of the values. That keeps `Animatable<T>` usable for any `T`,
 * including types plugins introduce that this package has never heard of.
 */

import type { Vec2 } from "@opencut/types";

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function lerpVec2(from: Vec2, to: Vec2, t: number): Vec2 {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parses `#rgb`, `#rrggbb`, or `#rrggbbaa`.
 *
 * Returns `null` for anything else — named colors and `rgb()` strings are not
 * accepted, because silently mis-parsing a color produces a wrong render that
 * nobody traces back to the parser.
 */
export function parseHexColor(value: string): RGB | null {
  const hex = value.trim().replace(/^#/, "");

  // Validate the alphabet before parsing. Skipping this lets a 3-letter word
  // like "red" reach the shorthand branch, where `parseInt("rr", 16)` yields
  // NaN and produces a corrupt color instead of an honest failure.
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  const expand = (component: string) => parseInt(component.repeat(2), 16);

  if (hex.length === 3) {
    const [r, g, b] = [hex[0]!, hex[1]!, hex[2]!];
    return { r: expand(r), g: expand(g), b: expand(b), a: 1 };
  }

  if (hex.length === 6 || hex.length === 8) {
    const parsed = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
    return Number.isNaN(parsed.r) || Number.isNaN(parsed.g) || Number.isNaN(parsed.b)
      ? null
      : parsed;
  }

  return null;
}

export function formatHexColor(color: RGB): string {
  const component = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");

  const base = `#${component(color.r)}${component(color.g)}${component(color.b)}`;
  return color.a >= 1 ? base : `${base}${component(color.a * 255)}`;
}

/**
 * Interpolates two colors.
 *
 * Done in sRGB rather than a perceptual space. That is a deliberate trade: it
 * matches what CSS, After Effects, and Premiere all do, so a gradient authored
 * elsewhere lands the same here. Perceptual blending would look better in
 * isolation and *wrong* next to every other tool.
 */
export function lerpColor(from: string, to: string, t: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  if (!start || !end) return t < 0.5 ? from : to;

  return formatHexColor({
    r: lerp(start.r, end.r, t),
    g: lerp(start.g, end.g, t),
    b: lerp(start.b, end.b, t),
    a: lerp(start.a, end.a, t),
  });
}

function isVec2(value: unknown): value is Vec2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Vec2).x === "number" &&
    typeof (value as Vec2).y === "number"
  );
}

function isHexColorString(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

/**
 * Interpolates any two like-typed values.
 *
 * Values that cannot be meaningfully blended (booleans, enums, arbitrary
 * strings) snap at the midpoint rather than erroring. A non-interpolatable
 * property is a legitimate thing to keyframe — you just want it to switch.
 */
export function interpolate<T>(from: T, to: T, t: number): T {
  if (typeof from === "number" && typeof to === "number") {
    return lerp(from, to, t) as T;
  }

  if (isHexColorString(from) && isHexColorString(to)) {
    return lerpColor(from, to, t) as T;
  }

  if (isVec2(from) && isVec2(to)) {
    return lerpVec2(from, to, t) as T;
  }

  // Generic objects: interpolate matching numeric fields, keep the rest from
  // the source. This is what makes compound values like `crop` animate without
  // needing a bespoke case.
  if (
    typeof from === "object" &&
    from !== null &&
    typeof to === "object" &&
    to !== null &&
    !Array.isArray(from)
  ) {
    const result: Record<string, unknown> = { ...(from as Record<string, unknown>) };
    const target = to as Record<string, unknown>;

    for (const [key, value] of Object.entries(from as Record<string, unknown>)) {
      const other = target[key];
      if (typeof value === "number" && typeof other === "number") {
        result[key] = lerp(value, other, t);
      }
    }

    return result as T;
  }

  return t < 0.5 ? from : to;
}
