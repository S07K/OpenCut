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
export function useKeyboardShortcuts(onSave?: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const isSaveCombo =
        (event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S");
      // Every shortcut yields to text entry except save: renaming the project
      // and then pressing Cmd+S is an entirely normal sequence.
      if (isTextEntry && !isSaveCombo) return;

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
          if (event.metaKey || event.ctrlKey) {
            // Claim Cmd/Ctrl+S so the browser does not offer to save the page,
            // which is never what someone means in an editor.
            event.preventDefault();
            onSave?.();
            return;
          }
          event.preventDefault();
          state.splitAtPlayhead();
          break;

        case "z":
        case "Z":
          if (!event.metaKey && !event.ctrlKey) break;
          event.preventDefault();
          // Cmd+Shift+Z is redo everywhere except Windows, where Ctrl+Y is the
          // convention; both are accepted so neither audience has to relearn.
          if (event.shiftKey) state.redo();
          else state.undo();
          return;

        case "y":
        case "Y":
          if (!event.ctrlKey) break;
          event.preventDefault();
          state.redo();
          return;

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
  }, [onSave]);
}
