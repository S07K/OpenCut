import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistory,
  MAX_HISTORY_DEPTH,
  seal,
  push,
  redo,
  redoLabel,
  reset,
  size,
  undo,
  undoLabel,
  type History,
} from "../stack";

/** Pushes a sequence of states at a fixed time, so merging is deterministic. */
function pushAll(history: History<string>, states: string[], now = 0): History<string> {
  return states.reduce(
    (acc, state, index) => push(acc, state, { label: `Set ${state}`, now: now + index * 10_000 }),
    history,
  );
}

describe("push / undo / redo", () => {
  it("moves between states", () => {
    let history = createHistory("a");
    history = pushAll(history, ["b", "c"]);

    expect(history.present.state).toBe("c");

    history = undo(history);
    expect(history.present.state).toBe("b");

    history = undo(history);
    expect(history.present.state).toBe("a");

    history = redo(history);
    expect(history.present.state).toBe("b");
  });

  it("reports what can be undone and redone", () => {
    let history = createHistory("a");
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);

    history = push(history, "b", { label: "Set b" });
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    history = undo(history);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);
  });

  it("is a no-op at the ends", () => {
    const history = createHistory("a");
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it("clears the redo branch on a new edit", () => {
    // Editing from an undone position makes the undone branch unreachable —
    // keeping it would require a history tree users do not expect.
    let history = pushAll(createHistory("a"), ["b", "c"]);
    history = undo(history);
    expect(canRedo(history)).toBe(true);

    history = push(history, "d", { label: "Set d", now: 99_000 });
    expect(canRedo(history)).toBe(false);
    expect(history.present.state).toBe("d");
  });

  it("survives a long undo/redo round trip unchanged", () => {
    let history = pushAll(createHistory("a"), ["b", "c", "d", "e"]);
    for (let i = 0; i < 4; i += 1) history = undo(history);
    expect(history.present.state).toBe("a");

    for (let i = 0; i < 4; i += 1) history = redo(history);
    expect(history.present.state).toBe("e");
  });
});

describe("merging", () => {
  it("collapses consecutive edits sharing a key", () => {
    // A drag fires an update per pointer move; undo must step back over the
    // whole gesture, not one pixel at a time.
    let history = createHistory("start");
    history = push(history, "drag1", { label: "Move clip", mergeKey: "move:c1", now: 0 });
    history = push(history, "drag2", { label: "Move clip", mergeKey: "move:c1", now: 100 });
    history = push(history, "drag3", { label: "Move clip", mergeKey: "move:c1", now: 200 });

    expect(history.present.state).toBe("drag3");
    // One undo returns to before the gesture began.
    expect(undo(history).present.state).toBe("start");
    expect(size(history)).toBe(2);
  });

  it("does not merge across different keys", () => {
    let history = createHistory("start");
    history = push(history, "x", { label: "Move A", mergeKey: "move:a", now: 0 });
    history = push(history, "y", { label: "Move B", mergeKey: "move:b", now: 50 });

    expect(undo(history).present.state).toBe("x");
  });

  it("keeps merging however long the gesture takes", () => {
    // A user positioning a clip carefully may pause mid-drag. An elapsed-time
    // window would split that single gesture into several undo steps.
    let history = createHistory("start");
    history = push(history, "x", { label: "Move", mergeKey: "move:a", now: 0 });
    history = push(history, "y", { label: "Move", mergeKey: "move:a", now: 60_000 });

    expect(undo(history).present.state).toBe("start");
  });

  it("stops merging once the gesture is sealed", () => {
    let history = createHistory("start");
    history = push(history, "x", { label: "Move", mergeKey: "move:a", now: 0 });
    history = seal(history);
    history = push(history, "y", { label: "Move", mergeKey: "move:a", now: 10 });

    // Two separate drags of the same clip are two undo steps.
    expect(undo(history).present.state).toBe("x");
  });

  it("treats sealing as idempotent and non-mutating", () => {
    const history = push(createHistory("a"), "b", { label: "Move", mergeKey: "m" });
    const sealed = seal(history);
    expect(seal(sealed)).toBe(sealed);
  });

  it("never merges entries with no key", () => {
    let history = createHistory("start");
    history = push(history, "x", { label: "Split", now: 0 });
    history = push(history, "y", { label: "Split", now: 10 });

    expect(undo(history).present.state).toBe("x");
  });

  it("keeps the latest label when merging", () => {
    let history = createHistory("start");
    history = push(history, "x", { label: "Move clip", mergeKey: "m", now: 0 });
    history = push(history, "y", { label: "Move clip to track 2", mergeKey: "m", now: 100 });

    expect(history.present.label).toBe("Move clip to track 2");
  });
});

describe("depth cap", () => {
  it("drops the oldest entries beyond the limit", () => {
    let history = createHistory(0 as unknown as string);
    for (let i = 1; i <= MAX_HISTORY_DEPTH + 20; i += 1) {
      history = push(history, String(i), { label: `Edit ${i}`, now: i * 10_000 });
    }

    expect(history.past).toHaveLength(MAX_HISTORY_DEPTH);
    // The most recent edits are always retained.
    expect(history.present.state).toBe(String(MAX_HISTORY_DEPTH + 20));
  });

  it("still undoes correctly after trimming", () => {
    let history = createHistory("initial");
    for (let i = 1; i <= MAX_HISTORY_DEPTH + 5; i += 1) {
      history = push(history, String(i), { label: `Edit ${i}`, now: i * 10_000 });
    }

    history = undo(history);
    expect(history.present.state).toBe(String(MAX_HISTORY_DEPTH + 4));
  });
});

describe("labels", () => {
  it("names the action undo would reverse", () => {
    let history = createHistory("a");
    expect(undoLabel(history)).toBeNull();

    history = push(history, "b", { label: "Split clip" });
    expect(undoLabel(history)).toBe("Split clip");

    history = undo(history);
    expect(redoLabel(history)).toBe("Split clip");
  });
});

describe("reset", () => {
  it("discards history around a new state", () => {
    // Undoing across a project load would resurrect clips from a document the
    // user is no longer editing.
    let history = pushAll(createHistory("a"), ["b", "c"]);
    history = reset("loaded");

    expect(history.present.state).toBe("loaded");
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe("immutability", () => {
  it("never mutates the history it is given", () => {
    const history = pushAll(createHistory("a"), ["b", "c"]);
    const snapshot = structuredClone(history);

    push(history, "d", { label: "Set d", now: 99_000 });
    undo(history);
    redo(history);

    expect(history).toEqual(snapshot);
  });

  it("shares unchanged state objects by reference", () => {
    // The property that makes snapshot history affordable: entries hold the
    // same object, not a copy of it.
    const shared = { clips: { a: 1 } };
    const history = push(createHistory({ v: 0, shared }), { v: 1, shared }, { label: "Edit" });

    expect(history.present.state.shared).toBe(history.past[0]!.state.shared);
  });
});
