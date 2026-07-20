"use client";

import { create } from "zustand";
import type { Clip, Frame, Id, ProjectDocument, Track } from "@opencut/types";
import { computeDuration, moveClip, rippleDelete, splitClip } from "@opencut/timeline-engine";
import { createId } from "@opencut/utils";
import { createDemoProject } from "./demoProject";

/**
 * Editor state.
 *
 * Split deliberately into two halves:
 *
 * - `project` — the serializable document. This is what gets saved, undone, and
 *   exported.
 * - everything else — *ephemeral* view state (playhead, zoom, selection). It is
 *   intentionally **not** part of the document, because nobody wants "I scrolled
 *   the timeline" in their undo history, and nobody wants a merge conflict over
 *   where someone's playhead was.
 *
 * Mutations funnel through `updateProject`, which is the seam where the history
 * engine will attach in Phase 2 — at that point actions become Commands and
 * this store stops being the mutation authority.
 */

/** Zoom bounds in pixels-per-frame. */
export const MIN_PIXELS_PER_FRAME = 0.2;
export const MAX_PIXELS_PER_FRAME = 40;
export const DEFAULT_PIXELS_PER_FRAME = 4;

export interface EditorState {
  project: ProjectDocument;

  // --- Ephemeral view state ---
  playhead: Frame;
  pixelsPerFrame: number;
  /** Leftmost visible frame in the timeline viewport. */
  scrollFrame: number;
  selectedClipIds: Id[];
  isPlaying: boolean;
  snapEnabled: boolean;

  // --- Actions ---
  setPlayhead: (frame: Frame) => void;
  setZoom: (pixelsPerFrame: number) => void;
  zoomBy: (factor: number) => void;
  setScrollFrame: (frame: number) => void;
  selectClips: (ids: Id[]) => void;
  toggleClipSelection: (id: Id) => void;
  clearSelection: () => void;
  togglePlaying: () => void;
  toggleSnap: () => void;

  moveClipTo: (clipId: Id, startFrame: Frame, trackId?: Id) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  setTrackFlag: (trackId: Id, flag: "locked" | "hidden" | "muted", value: boolean) => void;
}

/** Recomputes derived document fields after any structural edit. */
function withDerived(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    durationFrames: computeDuration(Object.values(project.entities.clips)),
    modifiedAt: Date.now(),
  };
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  project: createDemoProject(),

  playhead: 0,
  pixelsPerFrame: DEFAULT_PIXELS_PER_FRAME,
  scrollFrame: 0,
  selectedClipIds: [],
  isPlaying: false,
  snapEnabled: true,

  setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),

  setZoom: (pixelsPerFrame) =>
    set({
      pixelsPerFrame: Math.min(
        MAX_PIXELS_PER_FRAME,
        Math.max(MIN_PIXELS_PER_FRAME, pixelsPerFrame),
      ),
    }),

  zoomBy: (factor) => get().setZoom(get().pixelsPerFrame * factor),

  setScrollFrame: (frame) => set({ scrollFrame: Math.max(0, frame) }),

  selectClips: (ids) => set({ selectedClipIds: ids }),

  toggleClipSelection: (id) =>
    set((state) => ({
      selectedClipIds: state.selectedClipIds.includes(id)
        ? state.selectedClipIds.filter((existing) => existing !== id)
        : [...state.selectedClipIds, id],
    })),

  clearSelection: () => set({ selectedClipIds: [] }),

  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),

  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),

  moveClipTo: (clipId, startFrame, trackId) =>
    set((state) => {
      const clip = state.project.entities.clips[clipId];
      if (!clip || clip.locked) return state;

      const moved = moveClip(clip, startFrame, trackId);
      return {
        project: withDerived({
          ...state.project,
          entities: {
            ...state.project.entities,
            clips: { ...state.project.entities.clips, [clipId]: moved },
          },
        }),
      };
    }),

  splitAtPlayhead: () =>
    set((state) => {
      const { playhead, selectedClipIds } = state;
      const clips = { ...state.project.entities.clips };

      // Split the selection if there is one; otherwise split whatever the
      // playhead is over. Matching Premiere's behaviour here means users do not
      // have to select first for the common case.
      const candidates =
        selectedClipIds.length > 0
          ? selectedClipIds.map((id) => clips[id]).filter((c): c is Clip => Boolean(c))
          : Object.values(clips).filter(
              (c) => playhead > c.startFrame && playhead < c.startFrame + c.durationFrames,
            );

      let didSplit = false;
      for (const clip of candidates) {
        if (clip.locked) continue;
        const result = splitClip(clip, playhead, createId("clip"));
        if (!result) continue;

        const [left, right] = result;
        clips[left.id] = left;
        clips[right.id] = right;
        didSplit = true;
      }

      if (!didSplit) return state;

      return {
        project: withDerived({
          ...state.project,
          entities: { ...state.project.entities, clips },
        }),
      };
    }),

  deleteSelected: () =>
    set((state) => {
      const { selectedClipIds } = state;
      if (selectedClipIds.length === 0) return state;

      const clips = { ...state.project.entities.clips };
      // Ripple per track, because pulling clips back across tracks would
      // desynchronize content the user deliberately aligned.
      const byTrack = new Map<Id, Clip[]>();
      for (const clip of Object.values(clips)) {
        const list = byTrack.get(clip.trackId) ?? [];
        list.push(clip);
        byTrack.set(clip.trackId, list);
      }

      for (const clipId of selectedClipIds) {
        const target = clips[clipId];
        if (!target || target.locked) continue;

        const trackClips = byTrack.get(target.trackId) ?? [];
        const remaining = rippleDelete(trackClips, clipId);

        delete clips[clipId];
        for (const clip of remaining) clips[clip.id] = clip;
        byTrack.set(target.trackId, remaining);
      }

      return {
        selectedClipIds: [],
        project: withDerived({
          ...state.project,
          entities: { ...state.project.entities, clips },
        }),
      };
    }),

  setTrackFlag: (trackId, flag, value) =>
    set((state) => {
      const track = state.project.entities.tracks[trackId];
      if (!track) return state;

      const updated: Track = { ...track, [flag]: value };
      return {
        project: {
          ...state.project,
          entities: {
            ...state.project.entities,
            tracks: { ...state.project.entities.tracks, [trackId]: updated },
          },
        },
      };
    }),
}));

/** Tracks in render order. Kept as a helper so components never sort inline. */
export function selectOrderedTracks(state: EditorState): Track[] {
  return state.project.trackOrder
    .map((id) => state.project.entities.tracks[id])
    .filter((track): track is Track => Boolean(track));
}

export function selectClipsArray(state: EditorState): Clip[] {
  return Object.values(state.project.entities.clips);
}
