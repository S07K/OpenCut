"use client";

import type { Clip } from "@opencut/types";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/state/editorStore";
import { groupedProperties } from "./propertySchema";
import { PropertyRow } from "./PropertyRow";
import { useClipProperties } from "./useClipProperties";
import { PresetPicker } from "@/features/animation/PresetPicker";

/**
 * The properties inspector for the selected clip.
 *
 * Subscribes to the clip by id and re-reads it from the document each render, so
 * an undo or a playhead move is reflected immediately. The panel is intentionally
 * a thin renderer over the property schema — it has no per-property knowledge,
 * so new animatable properties appear here for free.
 */
export function PropertiesPanel() {
  const selectedIds = useEditorStore(useShallow((state) => state.selectedClipIds));
  const clip = useEditorStore((state) =>
    selectedIds.length === 1 ? state.project.entities.clips[selectedIds[0]!] : undefined,
  );
  // Depended on so value fields refresh as the playhead crosses keyframes.
  const playhead = useEditorStore((state) => state.playhead);
  const api = useClipProperties();

  if (selectedIds.length === 0) {
    return <Empty message="Select a clip to edit its properties." />;
  }

  if (selectedIds.length > 1) {
    return <Empty message={`${selectedIds.length} clips selected. Select one to edit it.`} />;
  }

  if (!clip) return <Empty message="Clip not found." />;

  return (
    <div key={clip.id} className="flex flex-col gap-3 p-3">
      <ClipHeader clip={clip} playheadFrame={playhead} />

      <PresetPicker clip={clip} />

      {groupedProperties(clip).map(([group, descriptors]) => (
        <section key={group}>
          <h3 className="text-2xs text-text-tertiary mb-1 font-medium tracking-wide uppercase">
            {group}
          </h3>
          <div className="flex flex-col">
            {descriptors.map((descriptor) => (
              <PropertyRow key={descriptor.id} clip={clip} descriptor={descriptor} api={api} />
            ))}
          </div>
        </section>
      ))}

      {clip.content.kind === "audio" && (
        <p className="text-2xs text-text-tertiary">
          Audio clip — volume and fades editing arrives with the audio tools.
        </p>
      )}
    </div>
  );
}

function ClipHeader({ clip, playheadFrame }: { clip: Clip; playheadFrame: number }) {
  const overClip =
    playheadFrame >= clip.startFrame && playheadFrame < clip.startFrame + clip.durationFrames;

  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-text-primary truncate text-xs font-medium">{clip.name}</p>
      {!overClip && (
        // Editing a property while the playhead is off the clip still works, but
        // the change is invisible in the preview — worth saying so plainly.
        <span className="text-2xs text-warning shrink-0">Playhead off clip</span>
      )}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="text-text-tertiary p-3 text-xs">{message}</p>;
}
