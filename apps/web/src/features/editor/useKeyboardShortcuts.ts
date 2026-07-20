"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/state/editorStore";

/**
 * Global editor shortcuts.
 *
 * Bound on `window` rather than on a focused element, because editor shortcuts
 * are expected to work regardless of which panel has focus. The text-input
 * guard below is what makes that safe — without it, typing "s" into a caption
 * would split the timeline.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (isTextEntry) return;

      const state = useEditorStore.getState();
      const stepSize = event.shiftKey ? 10 : 1;

      switch (event.key) {
        case " ":
          event.preventDefault();
          state.togglePlaying();
          break;

        case "ArrowLeft":
          event.preventDefault();
          state.setPlayhead(state.playhead - stepSize);
          break;

        case "ArrowRight":
          event.preventDefault();
          state.setPlayhead(state.playhead + stepSize);
          break;

        case "Home":
          event.preventDefault();
          state.setPlayhead(0);
          break;

        case "End":
          event.preventDefault();
          state.setPlayhead(state.project.durationFrames);
          break;

        case "s":
        case "S":
          // Cmd/Ctrl+S is Save, which must not be hijacked by Split.
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          state.splitAtPlayhead();
          break;

        case "n":
        case "N":
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          state.toggleSnap();
          break;

        case "Delete":
        case "Backspace":
          event.preventDefault();
          state.deleteSelected();
          break;

        case "Escape":
          state.clearSelection();
          break;

        case "=":
        case "+":
          event.preventDefault();
          state.zoomBy(1.3);
          break;

        case "-":
          event.preventDefault();
          state.zoomBy(1 / 1.3);
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
