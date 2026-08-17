/**
 * `@cutaway/effects-engine` — the open-world effect registry and resolution.
 *
 * Pure and DOM-free. It answers *which* effects exist and *what* their
 * parameters are at a frame; the compositor answers *how* each id draws, keyed
 * by the same string. Splitting it this way is what lets a plugin add an effect
 * without the core knowing its name.
 */

import { EffectRegistry } from "./registry";
import { BUILTIN_EFFECTS } from "./builtins";

export * from "./registry";
export * from "./builtins";
export * from "./resolve";

/**
 * The editor's shared registry, pre-seeded with the built-in effects. Plugins
 * register onto this same instance so their effects appear alongside the core
 * ones everywhere the UI reads the registry.
 */
export const effectRegistry = new EffectRegistry();
effectRegistry.registerAll(BUILTIN_EFFECTS);
