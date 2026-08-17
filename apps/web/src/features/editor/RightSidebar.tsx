"use client";

import { useState } from "react";
import { Panel, cn } from "@cutaway/ui";
import { PropertiesPanel } from "@/features/properties/PropertiesPanel";
import { MasksPanel } from "@/features/masks/MasksPanel";
import { ColorPanel } from "@/features/color/ColorPanel";
import { EffectsPanel } from "@/features/effects/EffectsPanel";

const TABS = ["Properties", "Masks", "Color", "Effects"] as const;

type Tab = (typeof TABS)[number];

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("Properties");

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

        <div className="min-h-0 flex-1 overflow-auto">
          {activeTab === "Properties" ? (
            // Transform and Animation both live in the Properties panel — it
            // already sections by group and shows keyframe state per property,
            // so separate tabs would just fragment one coherent surface.
            <PropertiesPanel />
          ) : activeTab === "Masks" ? (
            <MasksPanel />
          ) : activeTab === "Color" ? (
            <ColorPanel />
          ) : (
            <EffectsPanel />
          )}
        </div>
      </div>
    </Panel>
  );
}
