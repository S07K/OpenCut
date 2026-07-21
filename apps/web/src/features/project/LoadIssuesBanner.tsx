"use client";

import { AlertTriangle, X } from "lucide-react";
import { useProject } from "./ProjectProvider";

/**
 * Reports what a project load repaired or discarded.
 *
 * Loading is deliberately forgiving — a corrupt clip is dropped so the rest of
 * the project still opens. But silently losing part of someone's work would be
 * indefensible, so every repair is stated plainly and stays on screen until it
 * is acknowledged.
 */
export function LoadIssuesBanner() {
  const { loadIssues, dismissIssues } = useProject();

  if (loadIssues.length === 0) return null;

  return (
    <div className="absolute bottom-10 left-1/2 z-40 w-[min(560px,90vw)] -translate-x-1/2">
      <div className="border-warning/40 bg-surface-overlay shadow-popover rounded-md border p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />

          <div className="min-w-0 flex-1">
            <p className="text-text-primary text-xs font-medium">
              Project opened with {loadIssues.length} issue
              {loadIssues.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
              {loadIssues.map((issue, index) => (
                <li key={index} className="text-2xs text-text-secondary">
                  {issue}
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={dismissIssues}
            aria-label="Dismiss"
            className="text-text-tertiary hover:text-text-primary shrink-0 rounded-xs p-0.5"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
