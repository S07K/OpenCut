import type { Id } from "@opencut/types";

/**
 * Generates a unique id.
 *
 * Prefers `crypto.randomUUID`, falling back to a random string where it is
 * unavailable (non-secure contexts, older runtimes). Ids only need to be unique
 * within one document, so the fallback's weaker entropy is not a correctness
 * problem — but it must never throw, because failing to mint an id would take
 * the whole editor down.
 */
export function createId(prefix?: string): Id {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return prefix ? `${prefix}_${raw}` : raw;
}
