"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useProjectPersistence, type ProjectPersistence } from "./useProjectPersistence";

/**
 * Shares one persistence pipeline across the app.
 *
 * The toolbar, the status bar, and the keyboard shortcut all act on saving.
 * Separate hook instances would each run their own autosave timer and their own
 * startup restore — meaning the restore could race itself and the document
 * would be written several times per keystroke.
 */
const ProjectContext = createContext<ProjectPersistence | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const persistence = useProjectPersistence();
  return <ProjectContext.Provider value={persistence}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectPersistence {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("useProject must be used within a ProjectProvider");
  return context;
}
