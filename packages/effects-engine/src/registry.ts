/**
 * The effect registry — the seam that makes effects open-world.
 *
 * Nothing in the document names a concrete effect; an EffectInstance only
 * carries a string `effectId`. The registry maps those strings to definitions
 * at runtime. Core effects and plugin effects register through the same door,
 * so the editor treats `com.acme.glitch` exactly as it treats `core.blur.gaussian`.
 *
 * A definition is only metadata: a parameter schema the UI builds a panel from,
 * plus a name and category. It says nothing about *how* the effect renders —
 * that lives in the compositor, keyed by the same id — which keeps this package
 * pure and free of any renderer dependency.
 */

import type { EffectDefinition } from "@cutaway/types";

export class EffectRegistry {
  private readonly definitions = new Map<string, EffectDefinition>();

  /**
   * Registers a definition. Last write wins, so a plugin can deliberately
   * override a core effect by re-registering its id; callers that must not
   * clobber should check {@link has} first.
   */
  register(definition: EffectDefinition): void {
    this.definitions.set(definition.effectId, definition);
  }

  registerAll(definitions: readonly EffectDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  unregister(effectId: string): void {
    this.definitions.delete(effectId);
  }

  has(effectId: string): boolean {
    return this.definitions.has(effectId);
  }

  /** The definition for `effectId`, or undefined for an unknown (e.g. missing plugin). */
  get(effectId: string): EffectDefinition | undefined {
    return this.definitions.get(effectId);
  }

  /** All definitions, in registration order. */
  list(): EffectDefinition[] {
    return [...this.definitions.values()];
  }

  /** Definitions grouped by their `category`, preserving registration order within each. */
  byCategory(): Map<string, EffectDefinition[]> {
    const groups = new Map<string, EffectDefinition[]>();
    for (const definition of this.definitions.values()) {
      const group = groups.get(definition.category) ?? [];
      group.push(definition);
      groups.set(definition.category, group);
    }
    return groups;
  }
}
