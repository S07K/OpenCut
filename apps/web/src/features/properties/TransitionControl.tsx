"use client";

import type { Clip, TransitionKind } from "@opencut/types";
import { cn } from "@opencut/ui";
import { useEditorStore } from "@/state/editorStore";
import { NumberField } from "./NumberField";

/**
 * Sets the transition *into* the selected clip from the previous clip on its
 * track. The transition is owned by the incoming clip, so this one control edits
 * the whole cut; the resolver renders the outgoing clip's tail across the
 * overlap. Duration is shown in seconds — the unit editors think in — and stored
 * as frames.
 */
const KINDS: { id: TransitionKind; label: string }[] = [
  { id: "crossfade", label: "Crossfade" },
  { id: "dip", label: "Dip to black" },
];

export function TransitionControl({ clip }: { clip: Clip }) {
  const updateClip = useEditorStore((state) => state.updateClip);
  const endGesture = useEditorStore((state) => state.endGesture);
  const fps = useEditorStore((state) => state.project.settings.frameRate);

  const transition = clip.transitionIn;

  const setKind = (kind: TransitionKind | null) =>
    updateClip(
      clip.id,
      (c) => ({
        ...c,
        transitionIn:
          kind === null
            ? null
            : { kind, durationFrames: c.transitionIn?.durationFrames ?? Math.round(fps * 0.5) },
      }),
      "Set transition",
    );

  const setDurationSeconds = (seconds: number) =>
    updateClip(
      clip.id,
      (c) =>
        c.transitionIn
          ? {
              ...c,
              transitionIn: {
                ...c.transitionIn,
                durationFrames: Math.max(1, Math.round(seconds * fps)),
              },
            }
          : c,
      "Transition duration",
      `transition:${clip.id}`,
    );

  return (
    <section>
      <h3 className="text-2xs text-text-tertiary mb-1 font-medium tracking-wide uppercase">
        Transition in
      </h3>
      <div className="flex flex-wrap gap-1">
        <Chip active={!transition} onClick={() => setKind(null)}>
          None
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k.id} active={transition?.kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </Chip>
        ))}
      </div>

      {transition && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-2xs text-text-secondary w-20 shrink-0">Duration (s)</span>
          <div className="w-24">
            <NumberField
              value={Number((transition.durationFrames / fps).toFixed(2))}
              step={0.1}
              min={0.1}
              max={10}
              onChange={setDurationSeconds}
              onCommit={endGesture}
            />
          </div>
        </div>
      )}

      <p className="text-2xs text-text-tertiary mt-1">
        Blends from the previous clip on this track into this one.
      </p>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-border-default text-2xs rounded-sm border px-2 py-1",
        "duration-fast transition-colors",
        active
          ? "border-accent bg-accent text-accent-text"
          : "bg-surface-raised text-text-secondary hover:border-accent hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
