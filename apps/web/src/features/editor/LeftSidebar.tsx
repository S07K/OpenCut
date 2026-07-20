"use client";

import { useState } from "react";
import {
  Captions,
  FolderOpen,
  LayoutTemplate,
  Plug,
  Shapes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Panel, cn } from "@opencut/ui";
import { MediaPanel } from "@/features/media/MediaPanel";

/**
 * The left rail and its active panel.
 *
 * A vertical icon rail rather than tabs across the top: the rail scales to a
 * dozen sections without wrapping, and it is where every tool in this category
 * (Figma, Premiere, Resolve) has trained users to look.
 */

interface SidebarSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: SidebarSection[] = [
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "effects", label: "Effects", icon: Sparkles },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "assets", label: "Assets", icon: Shapes },
  { id: "plugins", label: "Plugins", icon: Plug },
];

export function LeftSidebar() {
  const [activeId, setActiveId] = useState("media");
  const active = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0]!;

  return (
    <div className="flex h-full">
      <nav
        aria-label="Editor sections"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface-base py-2"
      >
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeId;

          return (
            <button
              key={section.id}
              onClick={() => setActiveId(section.id)}
              aria-current={isActive}
              title={section.label}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-sm transition-colors duration-fast",
                "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                isActive
                  ? "bg-accent-muted text-accent"
                  : "text-text-tertiary hover:bg-surface-raised hover:text-text-primary",
              )}
            >
              <Icon size={17} />
              <span className="sr-only">{section.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">
        <Panel title={active.label} className="scrollbar-slim">
          {active.id === "media" ? <MediaPanel /> : <EmptySection label={active.label} />}
        </Panel>
      </div>
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="text-xs text-text-tertiary">Coming in a later milestone.</p>
    </div>
  );
}
