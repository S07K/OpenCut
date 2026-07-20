"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useMediaImport, type MediaImportApi } from "./useMediaImport";

/**
 * Shares one import pipeline across the app.
 *
 * The toolbar button, the media panel, and the window-wide drop target all
 * trigger imports. Without a shared provider each would build its own blob
 * store and its own progress state, so a drop would show a spinner in one place
 * and nothing in the others.
 */
const MediaImportContext = createContext<MediaImportApi | null>(null);

export function MediaImportProvider({ children }: { children: ReactNode }) {
  const api = useMediaImport();
  return <MediaImportContext.Provider value={api}>{children}</MediaImportContext.Provider>;
}

export function useMediaImportContext(): MediaImportApi {
  const context = useContext(MediaImportContext);
  if (!context) {
    throw new Error("useMediaImportContext must be used within a MediaImportProvider");
  }
  return context;
}
