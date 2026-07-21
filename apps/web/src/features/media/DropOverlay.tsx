"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { useMediaImportContext } from "./MediaImportProvider";

/**
 * Window-wide drag-and-drop target.
 *
 * Dropping footage anywhere on the editor imports it, rather than requiring the
 * user to aim at the media panel — which is what people actually try first.
 *
 * Drag events fire per-element as the pointer crosses children, so a naive
 * enter/leave pair flickers constantly. This tracks a depth counter instead:
 * the overlay hides only when every entered element has been left.
 */
export function DropOverlay() {
  const { importFromFiles } = useMediaImportContext();
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    /** True only for an OS file drag, not for internal element drags. */
    const carriesFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const handleDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Without this the browser navigates away to open the dropped file.
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setIsDragging(false);

      const files = event.dataTransfer?.files;
      if (files && files.length > 0) void importFromFiles(files);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [importFromFiles]);

  if (!isDragging) return null;

  return (
    <div className="bg-canvas/80 pointer-events-none fixed inset-0 z-50 grid place-items-center backdrop-blur-sm">
      <div className="border-accent flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-12 py-10">
        <Upload size={28} className="text-accent" />
        <p className="text-md text-text-primary font-medium">Drop to import</p>
        <p className="text-text-tertiary text-xs">
          Video, audio, and images — stored locally, never uploaded
        </p>
      </div>
    </div>
  );
}
