"use client";

import { Circle, Eye, EyeOff, RectangleHorizontal, Trash2 } from "lucide-react";
import type { Clip, Mask, Vec2 } from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";
import { createEllipseMask, createRectangleMask } from "@opencut/mask-engine";
import { IconButton, cn } from "@opencut/ui";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/state/editorStore";

/**
 * Mask list and creation for the selected clip.
 *
 * New masks are sized to a fraction of the project frame and centred, so a
 * freshly-added mask is immediately visible and sensibly placed rather than a
 * zero-size shape the user has to hunt for. All edits go through `updateClip`,
 * so each is one undo step and autosaves.
 *
 * This is the list/CRUD surface; dragging the shape itself on the preview is
 * the drawing overlay, a later increment.
 */
export function MasksPanel() {
  const selectedIds = useEditorStore(useShallow((state) => state.selectedClipIds));
  const clip = useEditorStore((state) =>
    selectedIds.length === 1 ? state.project.entities.clips[selectedIds[0]!] : undefined,
  );
  const resolution = useEditorStore((state) => state.project.settings.resolution);
  const playhead = useEditorStore((state) => state.playhead);
  const updateClip = useEditorStore((state) => state.updateClip);

  if (!clip) {
    return <p className="text-text-tertiary p-3 text-xs">Select a clip to add a mask.</p>;
  }
  if (clip.content.kind === "audio") {
    return <p className="text-text-tertiary p-3 text-xs">Audio clips cannot be masked.</p>;
  }

  const addMask = (make: () => Mask) =>
    updateClip(clip.id, (c) => ({ ...c, masks: [...c.masks, make()] }), "Add mask");

  // Mask units are content-local (the mask graphic is a child of the scaled
  // content, After Effects style), so a default sized in raw frame pixels would
  // render clip-scale times too big. Dividing by the clip's scale makes a new
  // mask appear as ~a third of the frame whatever the content's scale is.
  const scale = evaluate(clip.transform.scale, playhead) as Vec2;
  const w = resolution.width / 3 / (scale.x || 1);
  const h = resolution.height / 3 / (scale.y || 1);

  const setMask = (maskId: string, patch: Partial<Mask>, label: string) =>
    updateClip(
      clip.id,
      (c) => ({ ...c, masks: c.masks.map((m) => (m.id === maskId ? { ...m, ...patch } : m)) }),
      label,
    );

  const removeMask = (maskId: string) =>
    updateClip(
      clip.id,
      (c) => ({ ...c, masks: c.masks.filter((m) => m.id !== maskId) }),
      "Remove mask",
    );

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-1.5">
        <AddButton
          icon={<RectangleHorizontal size={13} />}
          label="Rectangle"
          onClick={() => addMask(() => createRectangleMask({ x: 0, y: 0 }, { x: w, y: h }))}
        />
        <AddButton
          icon={<Circle size={13} />}
          label="Ellipse"
          onClick={() => addMask(() => createEllipseMask({ x: 0, y: 0 }, { x: w / 2, y: h / 2 }))}
        />
      </div>

      {clip.masks.length === 0 ? (
        <p className="text-text-tertiary text-2xs">No masks. Add one above to clip this layer.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clip.masks.map((mask) => (
            <li
              key={mask.id}
              className="border-border-subtle bg-surface-raised flex items-center gap-1.5 rounded-sm border px-2 py-1"
            >
              <span
                className={cn(
                  "text-2xs min-w-0 flex-1 truncate",
                  mask.enabled ? "text-text-primary" : "text-text-tertiary",
                )}
              >
                {mask.name}
              </span>

              <button
                onClick={() => setMask(mask.id, { inverted: !mask.inverted }, "Invert mask")}
                title="Invert mask"
                className={cn(
                  "text-2xs rounded-xs px-1",
                  mask.inverted ? "text-accent" : "text-text-tertiary hover:text-text-primary",
                )}
              >
                INV
              </button>

              <IconButton
                size="sm"
                label={mask.enabled ? "Disable mask" : "Enable mask"}
                active={!mask.enabled}
                onClick={() => setMask(mask.id, { enabled: !mask.enabled }, "Toggle mask")}
              >
                {mask.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconButton>

              <IconButton size="sm" label="Remove mask" onClick={() => removeMask(mask.id)}>
                <Trash2 size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-border-default bg-surface-raised text-text-secondary text-2xs flex flex-1 items-center justify-center gap-1 rounded-sm border py-1.5",
        "duration-fast hover:border-accent hover:text-text-primary transition-colors",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
