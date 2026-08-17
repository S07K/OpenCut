/**
 * `@cutaway/mask-engine` — evaluating masks into drawable geometry.
 *
 * Pure and DOM-free. Every mask kind reduces to one `ResolvedMask` polygon, so
 * the compositor applies a single masking implementation regardless of how the
 * shape was authored. The GPU fills the polygon; this package decides its shape.
 */

export * from "./evaluate";
export * from "./factory";
