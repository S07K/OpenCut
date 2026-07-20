"use client";

import { useRef } from "react";
import { Download, Import, Redo2, Search, Settings, Undo2 } from "lucide-react";
import { Button, IconButton } from "@opencut/ui";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";

export function TopToolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { importFromFiles, isImporting } = useMediaImportContext();
  const projectName = useEditorStore((state) => state.project.name);
  const resolution = useEditorStore((state) => state.project.settings.resolution);
  const fps = useEditorStore((state) => state.project.settings.frameRate);

  return (
    <header className="flex h-(--size-toolbar-height) shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="grid h-6 w-6 place-items-center rounded-sm bg-accent text-xs font-bold text-accent-text">
          O
        </div>
        <span className="text-sm font-semibold text-text-primary">OpenCut</span>
      </div>

      <div className="mx-1 h-5 w-px bg-border-subtle" />

      <Button
        size="sm"
        variant="ghost"
        icon={<Import size={14} />}
        disabled={isImporting}
        onClick={() => inputRef.current?.click()}
      >
        {isImporting ? "Importing…" : "Import"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void importFromFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {/* Undo/redo are inert until the history engine lands in Phase 2. They
          are rendered disabled rather than hidden so the toolbar's final layout
          is visible now and does not shift later. */}
      <IconButton size="sm" label="Undo" disabled>
        <Undo2 size={14} />
      </IconButton>
      <IconButton size="sm" label="Redo" disabled>
        <Redo2 size={14} />
      </IconButton>

      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-text-primary">{projectName}</span>
          <span className="tabular text-text-tertiary">
            {resolution.width}×{resolution.height} · {fps}fps
          </span>
        </div>
      </div>

      <IconButton size="sm" label="Search (Cmd+K)">
        <Search size={14} />
      </IconButton>
      <IconButton size="sm" label="Project settings">
        <Settings size={14} />
      </IconButton>

      <Button size="sm" variant="primary" icon={<Download size={14} />}>
        Export
      </Button>
    </header>
  );
}
