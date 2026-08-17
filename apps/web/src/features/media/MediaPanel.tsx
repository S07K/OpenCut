"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  FileAudio,
  Film,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { MediaAsset } from "@cutaway/types";
import { formatByteSize, type MediaBlobStore } from "@cutaway/media-engine";
import { Button, IconButton, cn } from "@cutaway/ui";
import { useShallow } from "zustand/react/shallow";
import { useMediaImportContext } from "./MediaImportProvider";
import { useBlobUrl } from "./useBlobUrl";
import { useEditorStore } from "@/state/editorStore";

/** Formats a duration in seconds as `M:SS`. */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

export function MediaPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const { importFromFiles, isImporting, pending, errors, dismissErrors, store, removeAsset } =
    useMediaImportContext();

  const assets = useEditorStore(useShallow((state) => Object.values(state.project.entities.media)));

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      void importFromFiles(event.dataTransfer.files);
    },
    [importFromFiles],
  );

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="shrink-0 p-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          icon={<Upload size={13} />}
          onClick={() => inputRef.current?.click()}
        >
          Import media
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void importFromFiles(event.target.files);
            // Reset so selecting the same file twice still fires a change event.
            event.target.value = "";
          }}
        />
      </div>

      {errors.length > 0 && (
        <div className="border-danger/40 bg-danger/10 mx-2 mb-2 shrink-0 rounded-sm border p-2">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={13} className="text-danger mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              {errors.map((error) => (
                <p key={error.fileName} className="text-2xs text-text-secondary truncate">
                  <span className="text-text-primary">{error.fileName}</span> — {error.message}
                </p>
              ))}
            </div>
            <button
              onClick={dismissErrors}
              className="text-2xs text-text-tertiary hover:text-text-primary shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isImporting && (
        <p className="text-2xs text-text-tertiary shrink-0 px-3 pb-2">
          Importing {pending.length} file{pending.length === 1 ? "" : "s"}…
        </p>
      )}

      <div className="scrollbar-slim min-h-0 flex-1 overflow-auto px-2 pb-2">
        {assets.length === 0 ? (
          <EmptyState isDragOver={isDragOver} />
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {assets.map((asset) => (
              <MediaCard
                key={asset.id}
                asset={asset}
                store={store()}
                onRemove={() => void removeAsset(asset.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {isDragOver && assets.length > 0 && (
        <div className="border-accent bg-accent-muted pointer-events-none absolute inset-0 border-2" />
      )}
    </div>
  );
}

function EmptyState({ isDragOver }: { isDragOver: boolean }) {
  return (
    <div
      className={cn(
        "duration-fast flex h-full flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center transition-colors",
        isDragOver ? "border-accent bg-accent-muted" : "border-border-default",
      )}
    >
      <Upload size={20} className="text-text-tertiary" />
      <p className="text-text-secondary text-xs">Drop video, audio, or images</p>
      <p className="text-2xs text-text-tertiary">
        Files stay on your device — nothing is uploaded.
      </p>
    </div>
  );
}

function MediaCard({
  asset,
  store,
  onRemove,
}: {
  asset: MediaAsset;
  store: MediaBlobStore;
  onRemove: () => void;
}) {
  const thumbnailUrl = useBlobUrl(store, asset.thumbnailKey);
  const addClipFromAsset = useEditorStore((state) => state.addClipFromAsset);

  const Icon = asset.kind === "audio" ? FileAudio : asset.kind === "video" ? Film : ImageIcon;

  return (
    <li className="group relative">
      <button
        onClick={() => addClipFromAsset(asset.id)}
        title={`Add ${asset.name} to timeline`}
        className={cn(
          "border-border-subtle bg-surface-raised w-full overflow-hidden rounded-sm border text-left",
          "duration-fast hover:border-accent transition-colors",
          "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <div className="bg-canvas relative grid aspect-video place-items-center">
          {thumbnailUrl ? (
            // next/image cannot optimize an object URL from IndexedDB, so it would
            // add overhead and no benefit here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon size={18} className="text-text-tertiary" />
          )}

          {asset.metadata.durationSeconds > 0 && (
            <span className="tabular text-2xs absolute right-1 bottom-1 rounded-xs bg-black/70 px-1 text-white">
              {formatSeconds(asset.metadata.durationSeconds)}
            </span>
          )}
        </div>

        <div className="p-1.5">
          <p className="text-2xs text-text-primary truncate">{asset.name}</p>
          <p className="text-2xs text-text-tertiary">{formatByteSize(asset.metadata.byteSize)}</p>
        </div>
      </button>

      <div className="duration-fast absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          size="sm"
          variant="secondary"
          label={`Add ${asset.name} to timeline`}
          onClick={() => addClipFromAsset(asset.id)}
        >
          <Plus size={12} />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={`Remove ${asset.name}`} onClick={onRemove}>
          <Trash2 size={12} />
        </IconButton>
      </div>
    </li>
  );
}
