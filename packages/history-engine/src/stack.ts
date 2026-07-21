/**
 * Undo/redo history.
 *
 * **Design note — snapshots, not inverse commands.**
 *
 * The original plan was `Command { apply, invert }`. This stores immutable
 * document snapshots instead, and that is a deliberate revision:
 *
 * - Every hand-written `invert` is a chance to be subtly wrong, and a wrong
 *   inverse corrupts the user's project *silently* — the worst failure mode in
 *   an editor. A snapshot cannot be wrong; it is what the document was.
 * - The document is normalized and updated immutably, so unchanged entities are
 *   shared by reference between snapshots. Storing the previous document costs
 *   the changed nodes only. This is exactly the property document invariant (2)
 *   was chosen to provide.
 * - Undo and redo become O(1) pointer moves rather than replayed computation.
 *
 * What is kept from the command idea is *intent*: each entry carries a label
 * ("Split clip") for the UI, and a merge key so a drag collapses into one undo
 * step. Scripting and macros, when they arrive, describe intent at the action
 * layer — they do not need the history to be replayable.
 *
 * The trade-off accepted: memory grows with edit count rather than staying
 * constant, which `MAX_HISTORY_DEPTH` bounds.
 */

export interface HistoryEntry<T> {
  state: T;
  /** Shown in the UI, e.g. "Undo Split clip". */
  label: string;
  /**
   * Consecutive entries sharing a key collapse into one. This is what stops a
   * 60-tick drag becoming 60 undo steps.
   */
  mergeKey: string | null;
  /**
   * Set when the gesture that produced this entry has ended, which closes it to
   * further merging.
   *
   * Merging is bounded by an explicit seal rather than by elapsed time: a user
   * positioning a clip carefully may pause mid-drag for as long as they like,
   * and a time window would split that single gesture into several undo steps.
   * The caller knows where the gesture ends — pointer-up — so it says so.
   */
  sealed: boolean;
  timestamp: number;
}

export interface History<T> {
  past: HistoryEntry<T>[];
  present: HistoryEntry<T>;
  future: HistoryEntry<T>[];
}

/** Entries retained before the oldest is dropped. */
export const MAX_HISTORY_DEPTH = 100;

export function createHistory<T>(initial: T, label = "Initial state"): History<T> {
  return {
    past: [],
    present: { state: initial, label, mergeKey: null, sealed: true, timestamp: Date.now() },
    future: [],
  };
}

export interface PushOptions {
  label: string;
  mergeKey?: string | null;
  /** Injectable for tests; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Records a new state.
 *
 * Pushing always clears the redo stack: once you edit from an undone position,
 * the branch you undid is unreachable. Keeping it would require a history tree,
 * which no editor in this class exposes and which users do not expect.
 */
export function push<T>(history: History<T>, state: T, options: PushOptions): History<T> {
  const now = options.now ?? Date.now();
  const mergeKey = options.mergeKey ?? null;

  const shouldMerge =
    mergeKey !== null && history.present.mergeKey === mergeKey && !history.present.sealed;

  if (shouldMerge) {
    // Replace the present rather than stacking. `past` is untouched, so undo
    // still jumps to before the whole gesture.
    return {
      past: history.past,
      present: { state, label: options.label, mergeKey, sealed: false, timestamp: now },
      future: [],
    };
  }

  const past = [...history.past, history.present];

  return {
    // Trim from the front: the oldest edits are the least likely to be undone.
    past: past.length > MAX_HISTORY_DEPTH ? past.slice(past.length - MAX_HISTORY_DEPTH) : past,
    present: { state, label: options.label, mergeKey, sealed: mergeKey === null, timestamp: now },
    future: [],
  };
}

/**
 * Closes the present entry to further merging.
 *
 * Called when a gesture ends — pointer-up on a drag, blur on a text field — so
 * the next action of the same kind starts a fresh undo step instead of
 * absorbing into the previous one.
 */
export function seal<T>(history: History<T>): History<T> {
  if (history.present.sealed) return history;
  return { ...history, present: { ...history.present, sealed: true } };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** Steps back one entry. Returns the history unchanged when there is none. */
export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (!next) return history;

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

/** Label of the action undo would reverse, for the UI tooltip. */
export function undoLabel<T>(history: History<T>): string | null {
  return canUndo(history) ? history.present.label : null;
}

export function redoLabel<T>(history: History<T>): string | null {
  return history.future[0]?.label ?? null;
}

/**
 * Discards all history around a new state.
 *
 * Used when loading a different project: undoing across a document swap would
 * resurrect clips from a project the user is no longer editing.
 */
export function reset<T>(state: T, label = "Project loaded"): History<T> {
  return createHistory(state, label);
}

/** Entry count, present included. Exposed for diagnostics and tests. */
export function size<T>(history: History<T>): number {
  return history.past.length + 1 + history.future.length;
}
