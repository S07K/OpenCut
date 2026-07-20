"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PanelProps {
  title?: string;
  /** Rendered at the right edge of the header — usually icon buttons. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Omits the header entirely, for panels that supply their own chrome. */
  bare?: boolean;
}

/**
 * The standard dock panel: a titled, scrollable surface.
 *
 * Every docked region uses this so headers, padding, and scroll behaviour stay
 * identical across the app — the thing that makes a UI feel designed rather
 * than assembled.
 */
export function Panel({ title, actions, children, className, bare }: PanelProps) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-surface-panel", className)}>
      {!bare && (
        <header
          className={cn(
            "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3",
          )}
        >
          <h2 className="truncate text-xs font-medium tracking-wide text-text-secondary uppercase">
            {title}
          </h2>
          {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
