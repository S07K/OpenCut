"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button, IconButton, cn } from "@opencut/ui";
import type { ExportFormat, ExportSettings, Size } from "@opencut/types";
import { describeExport, planExport } from "@opencut/export-engine";
import { useEditorStore } from "@/state/editorStore";
import { useExport } from "./useExport";

type Quality = "high" | "medium" | "low";

/** Bits per pixel per frame for each quality tier — the bitrate knob, normalised. */
const BPP: Record<Quality, number> = { high: 0.1, medium: 0.06, low: 0.03 };

/**
 * The export dialog: choose format, resolution, frame rate, and quality, watch
 * progress, and get the file.
 *
 * Settings are assembled locally and passed to the run rather than mutated into
 * the document — an export is a one-off action, and the pure `planExport` here
 * also validates the choice up front (and drives the summary line), so a bad
 * combination is caught before any encoder spins up.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const projectRes = useEditorStore((s) => s.project.settings.resolution);
  const projectFps = useEditorStore((s) => s.project.settings.frameRate);
  const stored = useEditorStore((s) => s.project.exportSettings);
  const durationFrames = useEditorStore((s) => s.project.durationFrames);

  const { isExporting, progress, error, done, start, cancel } = useExport();

  const [format, setFormat] = useState<ExportFormat>(stored.format === "webm" ? "webm" : "mp4");
  const [height, setHeight] = useState<number>(projectRes.height);
  const [frameRate, setFrameRate] = useState<number>(projectFps);
  const [quality, setQuality] = useState<Quality>("medium");

  // Close on Escape unless a render is in flight (cancel first, deliberately).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isExporting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExporting, onClose]);

  const resolution = useMemo(() => scaleToHeight(projectRes, height), [projectRes, height]);

  const settings: ExportSettings = useMemo(
    () => ({
      format,
      resolution,
      frameRate,
      videoBitrate: Math.max(
        500_000,
        Math.round(resolution.width * resolution.height * frameRate * BPP[quality]),
      ),
      audioBitrate: 192_000,
      videoCodec: format === "webm" ? "vp9" : "h264",
      audioCodec: format === "webm" ? "opus" : "aac",
      range: null,
    }),
    [format, resolution, frameRate, quality],
  );

  // Validate the chosen settings so the summary reflects real, encodable output.
  const summary = useMemo(() => {
    try {
      return describeExport(planExport({ durationFrames } as never, settings));
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid settings";
    }
  }, [durationFrames, settings]);

  const percent = Math.round((progress?.ratio ?? 0) * 100);
  const empty = durationFrames <= 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={() => !isExporting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export video"
        className="border-border-default bg-surface-panel w-[360px] max-w-full rounded-md border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-text-primary text-sm font-semibold">Export video</h2>
          <IconButton size="sm" label="Close" onClick={onClose} disabled={isExporting}>
            <X size={14} />
          </IconButton>
        </div>

        {isExporting ? (
          <ProgressView
            phase={progress?.phase ?? "preparing"}
            percent={percent}
            onCancel={cancel}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <Field label="Format">
              <Select value={format} onChange={(v) => setFormat(v as ExportFormat)}>
                <option value="mp4">MP4 (H.264)</option>
                <option value="webm">WebM (VP9)</option>
              </Select>
            </Field>

            <Field label="Resolution">
              <Select value={String(height)} onChange={(v) => setHeight(Number(v))}>
                <option value={String(projectRes.height)}>
                  Project ({projectRes.width}×{projectRes.height})
                </option>
                {[2160, 1440, 1080, 720, 480]
                  .filter((h) => h < projectRes.height)
                  .map((h) => (
                    <option key={h} value={String(h)}>
                      {h}p
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Frame rate">
              <Select value={String(frameRate)} onChange={(v) => setFrameRate(Number(v))}>
                <option value={String(projectFps)}>Project ({projectFps} fps)</option>
                {[24, 30, 60]
                  .filter((f) => f !== projectFps)
                  .map((f) => (
                    <option key={f} value={String(f)}>
                      {f} fps
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Quality">
              <Select value={quality} onChange={(v) => setQuality(v as Quality)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </Field>

            <p className="text-2xs text-text-tertiary tabular mt-1">{summary}</p>

            {error && <p className="text-danger text-2xs">Export failed: {error}</p>}
            {done && <p className="text-2xs text-accent">Exported — check your downloads.</p>}

            <Button
              size="sm"
              variant="primary"
              className="mt-1 w-full justify-center"
              disabled={empty}
              onClick={() => start(settings)}
            >
              {empty ? "Nothing to export" : "Export"}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ProgressView({
  phase,
  percent,
  onCancel,
}: {
  phase: string;
  percent: number;
  onCancel: () => void;
}) {
  const label: Record<string, string> = {
    preparing: "Preparing…",
    rendering: "Rendering frames…",
    finalizing: "Finalizing…",
    done: "Done",
  };
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label[phase] ?? "Exporting…"}</span>
        <span className="text-text-tertiary tabular">{percent}%</span>
      </div>
      <div className="bg-surface-raised h-2 overflow-hidden rounded-full">
        <div
          className="bg-accent duration-fast h-full rounded-full transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <Button size="sm" variant="ghost" className="w-full justify-center" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-2xs text-text-secondary">{label}</span>
      <div className="w-48">{children}</div>
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "bg-surface-input text-text-secondary hover:text-text-primary w-full rounded-xs px-2 py-1 text-xs",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {children}
    </select>
  );
}

/** Scales a resolution to a target height, preserving aspect and keeping even dims. */
function scaleToHeight(res: Size, targetHeight: number): Size {
  if (targetHeight >= res.height) return res; // never upscale past the project
  const scale = targetHeight / res.height;
  return { width: even(res.width * scale), height: even(targetHeight) };
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}
