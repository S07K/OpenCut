/**
 * `@cutaway/color-engine` — resolving a colour grade into shader-ready numbers.
 *
 * Pure and DOM-free. It decides *what* the grade values are at a frame; the
 * compositor's shader decides *how* to apply them, so preview and export grade
 * identically.
 */

export * from "./evaluate";
export * from "./presets";
