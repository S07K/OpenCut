"use client";

import { useState } from "react";
import { Panel, cn } from "@opencut/ui";
import { useEditorStore } from "@/state/editorStore";

const TABS = ["Properties", "Transform", "Animation", "Masks", "Color", "Effects"] as const;

type Tab = (typeof TABS)[number];

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("Properties");

  const selectedIds = useEditorStore((state) => state.selectedClipIds);
  const clips = useEditorStore((state) => state.project.entities.clips);

  const selectedClip = selectedIds.length === 1 ? clips[selectedIds[0]!] : undefined;

  return (
    <Panel bare className="scrollbar-slim">
      <div className="flex h-full flex-col">
        <div
          role="tablist"
          className="border-border-subtle flex shrink-0 gap-0.5 overflow-x-auto border-b px-1 py-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={tab === activeTab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "duration-fast shrink-0 rounded-xs px-2 py-1 text-xs transition-colors",
                "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                tab === activeTab
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-tertiary hover:text-text-primary",
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {selectedIds.length === 0 && (
            <p className="text-text-tertiary text-xs">Select a clip to edit its properties.</p>
          )}

          {selectedIds.length > 1 && (
            <p className="text-text-tertiary text-xs">
              {selectedIds.length} clips selected. Multi-edit arrives with the properties panel.
            </p>
          )}

          {selectedClip && (
            <dl className="space-y-2 text-xs">
              <Row label="Name" value={selectedClip.name} />
              <Row label="Kind" value={selectedClip.content.kind} />
              <Row label="Start" value={`${selectedClip.startFrame}f`} />
              <Row label="Duration" value={`${selectedClip.durationFrames}f`} />
              <Row label="Masks" value={String(selectedClip.masks.length)} />
              <Row label="Effects" value={String(selectedClip.effects.length)} />
            </dl>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="tabular text-text-primary truncate">{value}</dd>
    </div>
  );
}
