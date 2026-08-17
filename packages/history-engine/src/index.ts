/**
 * `@cutaway/history-engine` — undo/redo.
 *
 * Pure and generic over the state type: it knows nothing about projects, so it
 * is testable in isolation and reusable for any undoable stack.
 */

export * from "./stack";
