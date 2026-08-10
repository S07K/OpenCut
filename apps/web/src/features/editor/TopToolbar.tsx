"use client";

import { useRef, useState } from "react";
import { Download, FolderOpen, Import, Redo2, Save, Search, Settings, Undo2 } from "lucide-react";
import { Button, IconButton } from "@opencut/ui";
import { ASPECT_RATIOS, resolutionForAspect } from "@opencut/utils";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { useProject } from "@/features/project/ProjectProvider";
import { ExportDialog } from "@/features/export/ExportDialog";

export function TopToolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const { importFromFiles, isImporting } = useMediaImportContext();
  const { downloadProject, openProjectFile } = useProject();
  const projectName = useEditorStore((state) => state.project.name);
  const resolution = useEditorStore((state) => state.project.settings.resolution);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const renameProject = useEditorStore((state) => state.renameProject);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  // Subscribed to `history` rather than calling canUndo() so the buttons
  // re-render when the stack changes; a getter would read stale on first paint.
  const history = useEditorStore((state) => state.history);

  const undoable = history.past.length > 0;
  const redoable = history.future.length > 0;

  return (
    <header className="border-border-subtle bg-surface-panel flex h-(--size-toolbar-height) shrink-0 items-center gap-1 border-b px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="bg-accent text-accent-text grid h-6 w-6 place-items-center rounded-sm text-xs font-bold">
          O
        </div>
        <span className="text-text-primary text-sm font-semibold">OpenCut</span>
      </div>

      <div className="bg-border-subtle mx-1 h-5 w-px" />

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

      <IconButton
        size="sm"
        label={undoable ? `Undo ${history.present.label} (Cmd+Z)` : "Nothing to undo"}
        disabled={!undoable}
        onClick={undo}
      >
        <Undo2 size={14} />
      </IconButton>
      <IconButton
        size="sm"
        label={
          redoable ? `Redo ${history.future[0]?.label ?? ""} (Cmd+Shift+Z)` : "Nothing to redo"
        }
        disabled={!redoable}
        onClick={redo}
      >
        <Redo2 size={14} />
      </IconButton>

      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-xs">
          <input
            aria-label="Project name"
            value={projectName}
            onChange={(event) => renameProject(event.target.value)}
            className="text-text-primary hover:bg-surface-raised focus:bg-surface-input w-48 rounded-xs bg-transparent px-1 text-center text-xs font-medium focus:outline-none"
          />
          <AspectRatioMenu />
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

      <IconButton
        size="sm"
        label="Open project file"
        onClick={() => projectInputRef.current?.click()}
      >
        <FolderOpen size={14} />
      </IconButton>
      <input
        ref={projectInputRef}
        type="file"
        accept=".opencut,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openProjectFile(file);
          event.target.value = "";
        }}
      />
      <IconButton size="sm" label="Save project to a file" onClick={downloadProject}>
        <Save size={14} />
      </IconButton>

      <ExportButton />
    </header>
  );
}

/**
 * Export control — opens the export dialog, which owns settings and progress.
 */
function ExportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={<Download size={14} />}
        onClick={() => setOpen(true)}
      >
        Export
      </Button>
      {open && <ExportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Aspect-ratio switcher.
 *
 * A native <select> rather than a custom menu — it is keyboard-accessible for
 * free and this is a low-frequency control that does not warrant bespoke
 * popover chrome. Switching recomputes the resolution via the pure helper.
 */
function AspectRatioMenu() {
  const aspect = useEditorStore((state) => state.project.settings.aspectRatio);
  const setAspectRatio = useEditorStore((state) => state.setAspectRatio);

  return (
    <select
      aria-label="Aspect ratio"
      value={aspect === "custom" ? "" : aspect}
      onChange={(event) => {
        const option = ASPECT_RATIOS.find((o) => o.id === event.target.value);
        if (option) setAspectRatio(option.id, resolutionForAspect(option.ratio));
      }}
      className="bg-surface-input text-text-secondary hover:text-text-primary rounded-xs px-1 py-0.5 text-xs focus:outline-none"
    >
      {aspect === "custom" && <option value="">Custom</option>}
      {ASPECT_RATIOS.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
