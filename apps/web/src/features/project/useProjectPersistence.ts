"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectGarbage } from "@cutaway/media-engine";
import {
  parseProjectFile,
  referencedBlobKeys,
  serializeProject,
  projectFileName,
} from "@cutaway/project-io";
import type { ProjectDocument } from "@cutaway/types";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { useEditorStore } from "@/state/editorStore";
import {
  isStorageAvailable,
  listProjects,
  loadMostRecentProject,
  saveProject,
} from "@/state/projectStorage";

/**
 * Autosave, restore, and file import/export.
 *
 * Saving is debounced rather than immediate: dragging a clip fires a store
 * update on every pointer move, and writing the document to IndexedDB sixty
 * times a second would stall the drag. A short idle delay batches a gesture
 * into one write.
 */

/** Idle time before an autosave fires. */
const AUTOSAVE_DELAY_MS = 800;

export type SaveState = "idle" | "saving" | "saved" | "error" | "unavailable";

export interface ProjectPersistence {
  saveState: SaveState;
  lastSavedAt: number | null;
  /** Issues reported by the last load, e.g. clips dropped during repair. */
  loadIssues: string[];
  dismissIssues: () => void;
  saveNow: () => Promise<void>;
  downloadProject: () => void;
  openProjectFile: (file: File) => Promise<void>;
}

export function useProjectPersistence(): ProjectPersistence {
  const project = useEditorStore((state) => state.project);
  const replaceProject = useEditorStore((state) => state.replaceProject);
  const { store } = useMediaImportContext();

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [loadIssues, setLoadIssues] = useState<string[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Blocks autosave until the restore attempt has finished. */
  const restoredRef = useRef(false);

  const persist = useCallback(async (document: ProjectDocument) => {
    if (!isStorageAvailable()) {
      setSaveState("unavailable");
      return;
    }

    setSaveState("saving");
    try {
      await saveProject(document);
      setLastSavedAt(Date.now());
      setSaveState("saved");
    } catch {
      // Quota exhaustion or a private-browsing restriction. Surfaced in the
      // status bar rather than thrown, since the editor still works unsaved.
      setSaveState("error");
    }
  }, []);

  // --- Restore on startup, then sweep orphaned media --------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!isStorageAvailable()) {
        setSaveState("unavailable");
        restoredRef.current = true;
        return;
      }

      try {
        const stored = await loadMostRecentProject();
        if (!cancelled && stored) {
          replaceProject(stored.document);
          setLastSavedAt(stored.savedAt);
          setSaveState("saved");
        }

        // Sweep media belonging to no stored project. The referenced set must
        // span *every* project, not just the restored one — otherwise opening
        // project A would delete project B's footage.
        const all = await listProjects();
        const referenced = new Set<string>();
        for (const entry of all) {
          for (const key of referencedBlobKeys(entry.document)) referenced.add(key);
        }

        await collectGarbage(store(), referenced);
      } catch {
        // A failed restore must never block the editor from opening.
      } finally {
        restoredRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: restoring again on a later render would discard live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Debounced autosave ----------------------------------------------
  useEffect(() => {
    if (!restoredRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(project), AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [project, persist]);

  // --- Save on the way out ---------------------------------------------
  useEffect(() => {
    const handleBeforeUnload = () => {
      // A pending debounce would be lost when the tab closes, so the latest
      // state is flushed synchronously-ish here. Best effort: browsers do not
      // guarantee async work during unload.
      void saveProject(useEditorStore.getState().project);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await persist(useEditorStore.getState().project);
  }, [persist]);

  const downloadProject = useCallback(() => {
    const current = useEditorStore.getState().project;
    const blob = new Blob([serializeProject(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectFileName(current.name);
    anchor.click();

    URL.revokeObjectURL(url);
  }, []);

  const openProjectFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const result = parseProjectFile(text);

      if (!result.ok) {
        setLoadIssues([result.error]);
        return;
      }

      replaceProject(result.project);

      const messages = [
        ...result.migrations.map((entry) => `Migrated: ${entry}`),
        ...result.issues.map((issue) => issue.message),
      ];
      if (result.fromFuture) {
        messages.unshift(
          "This project was saved by a newer version of Cutaway; some data may be lost on save.",
        );
      }
      setLoadIssues(messages);
    },
    [replaceProject],
  );

  return {
    saveState,
    lastSavedAt,
    loadIssues,
    dismissIssues: () => setLoadIssues([]),
    saveNow,
    downloadProject,
    openProjectFile,
  };
}
