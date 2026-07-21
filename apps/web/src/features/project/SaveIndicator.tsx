"use client";

import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import { useProject } from "./ProjectProvider";

/**
 * Save status for the status bar.
 *
 * With no account and no cloud, the user has no external signal that their work
 * is safe. Saying so explicitly — including *where* it is saved — is what makes
 * a local-first tool trustworthy rather than merely offline.
 */
export function SaveIndicator() {
  const { saveState, lastSavedAt } = useProject();

  if (saveState === "unavailable") {
    return (
      <span className="text-warning flex items-center gap-1">
        <CloudOff size={11} />
        Storage unavailable — changes will be lost
      </span>
    );
  }

  if (saveState === "error") {
    return (
      <span className="text-danger flex items-center gap-1">
        <AlertTriangle size={11} />
        Could not save
      </span>
    );
  }

  if (saveState === "saving") {
    return (
      <span className="flex items-center gap-1">
        <Loader2 size={11} className="animate-spin" />
        Saving…
      </span>
    );
  }

  if (saveState === "saved" && lastSavedAt) {
    return (
      <span className="flex items-center gap-1">
        <Check size={11} />
        Saved locally {formatRelative(lastSavedAt)}
      </span>
    );
  }

  return <span>Not saved yet</span>;
}

/** Coarse relative time; the exact second is noise at this size. */
function formatRelative(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
