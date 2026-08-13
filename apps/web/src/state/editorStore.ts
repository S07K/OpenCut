"use client";

import { create } from "zustand";
import type {
  AspectRatioPreset,
  CaptionTrackData,
  Clip,
  Frame,
  Id,
  MediaAsset,
  ProjectDocument,
  Track,
} from "@opencut/types";
import { computeDuration, moveClip, rippleDelete, splitClip } from "@opencut/timeline-engine";
import { createClipForAsset, trackKindForAsset } from "@opencut/media-engine";
import { createId, createProject, createTrack } from "@opencut/utils";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  push as historyPush,
  redo as historyRedo,
  redoLabel as historyRedoLabel,
  reset as historyReset,
  seal as historySeal,
  undo as historyUndo,
  undoLabel as historyUndoLabel,
  type History,
} from "@opencut/history-engine";

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
 * Every document mutation funnels through `commit`, which is what keeps the
 * undo history complete. Writing to `project` directly anywhere in this file is
 * a bug: the edit would be silently unundoable, and the history's snapshot would
 * no longer match the live document.
 */

/** Zoom bounds in pixels-per-frame. */
export const MIN_PIXELS_PER_FRAME = 0.2;
export const MAX_PIXELS_PER_FRAME = 40;
export const DEFAULT_PIXELS_PER_FRAME = 4;

export interface EditorState {
  project: ProjectDocument;
  history: History<ProjectDocument>;

  // --- Ephemeral view state ---
  playhead: Frame;
  pixelsPerFrame: number;
  /** Leftmost visible frame in the timeline viewport. */
  scrollFrame: number;
  selectedClipIds: Id[];
  isPlaying: boolean;
  snapEnabled: boolean;
  /** Export in-point (inclusive), or null for "from the start". */
  inPoint: Frame | null;
  /** Export out-point (exclusive), or null for "to the end". */
  outPoint: Frame | null;

  // --- Actions ---
  setPlayhead: (frame: Frame) => void;
  /** Sets or clears the export in-point. Pass null to clear. */
  setInPoint: (frame: Frame | null) => void;
  /** Sets or clears the export out-point. Pass null to clear. */
  setOutPoint: (frame: Frame | null) => void;
  clearInOut: () => void;
  setZoom: (pixelsPerFrame: number) => void;
  zoomBy: (factor: number) => void;
  setScrollFrame: (frame: number) => void;
  selectClips: (ids: Id[]) => void;
  toggleClipSelection: (id: Id) => void;
  clearSelection: () => void;
  togglePlaying: () => void;
  toggleSnap: () => void;

  moveClipTo: (clipId: Id, startFrame: Frame, trackId?: Id) => void;
  /**
   * Generic single-clip update. The updater must be pure and return a new clip.
   * Kept generic so the store stays free of animation and property-schema
   * knowledge, which lives in the properties feature.
   */
  updateClip: (clipId: Id, updater: (clip: Clip) => Clip, label: string, mergeKey?: string) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  setTrackFlag: (trackId: Id, flag: "locked" | "hidden" | "muted", value: boolean) => void;
  /** Adds an empty track. Video tracks go on top (front); audio tracks at the bottom. */
  addTrack: (kind: "video" | "audio") => void;

  addMediaAssets: (assets: MediaAsset[]) => void;
  /** Replaces an asset in place, for late-arriving thumbnails and waveforms. */
  upsertMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: Id) => void;
  /** Appends a clip for the asset to the end of a compatible track. */
  addClipFromAsset: (assetId: Id) => void;

  /** Adds or replaces a caption track by id. */
  upsertCaptionTrack: (track: CaptionTrackData, label: string) => void;
  /** Removes a caption track. */
  removeCaptionTrack: (trackId: Id) => void;
  /** Applies a pure edit to a caption track by id, as one undo step. */
  updateCaptionTrack: (
    trackId: Id,
    updater: (track: CaptionTrackData) => CaptionTrackData,
    label: string,
    mergeKey?: string,
  ) => void;

  /** Swaps in a whole document, on project load or restore. */
  replaceProject: (project: ProjectDocument) => void;
  renameProject: (name: string) => void;
  /** Switches the project's output aspect ratio (and resolution). */
  setAspectRatio: (id: AspectRatioPreset, resolution: { width: number; height: number }) => void;

  undo: () => void;
  redo: () => void;
  /** Closes the current gesture so the next one is a separate undo step. */
  endGesture: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
}

/** Recomputes derived document fields after any structural edit. */
function withDerived(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    durationFrames: computeDuration(Object.values(project.entities.clips)),
    modifiedAt: Date.now(),
  };
}

/**
 * Records a document change in both the live state and the undo history.
 *
 * `mergeKey` collapses a continuous gesture into one undo step — dragging a clip
 * emits an update per pointer move, and without merging a single drag would cost
 * sixty presses of Cmd+Z.
 */
function commit(
  state: EditorState,
  project: ProjectDocument,
  label: string,
  mergeKey?: string,
): Pick<EditorState, "project" | "history"> {
  return {
    project,
    history: historyPush(state.history, project, { label, mergeKey: mergeKey ?? null }),
  };
}

const initialProject = createProject();

export const useEditorStore = create<EditorState>()((set, get) => ({
  // Opens empty. No demo content, no sample project — import your footage and
  // start, which is the whole promise of the tool.
  project: initialProject,
  history: createHistory(initialProject, "New project"),

  playhead: 0,
  pixelsPerFrame: DEFAULT_PIXELS_PER_FRAME,
  scrollFrame: 0,
  selectedClipIds: [],
  isPlaying: false,
  snapEnabled: true,
  inPoint: null,
  outPoint: null,

  setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),

  // In/out points keep `inPoint < outPoint` whenever both are set, so the export
  // range they define is always valid; setting one past the other clears the
  // other rather than producing an inverted range.
  setInPoint: (frame) =>
    set((state) => {
      if (frame === null) return { inPoint: null };
      const inPoint = Math.max(0, Math.round(frame));
      return {
        inPoint,
        outPoint: state.outPoint !== null && state.outPoint <= inPoint ? null : state.outPoint,
      };
    }),

  setOutPoint: (frame) =>
    set((state) => {
      if (frame === null) return { outPoint: null };
      const outPoint = Math.max(0, Math.round(frame));
      return {
        outPoint,
        inPoint: state.inPoint !== null && state.inPoint >= outPoint ? null : state.inPoint,
      };
    }),

  clearInOut: () => set({ inPoint: null, outPoint: null }),

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
      return commit(
        state,
        withDerived({
          ...state.project,
          entities: {
            ...state.project.entities,
            clips: { ...state.project.entities.clips, [clipId]: moved },
          },
        }),
        "Move clip",
        `move:${clipId}`,
      );
    }),

  updateClip: (clipId, updater, label, mergeKey) =>
    set((state) => {
      const clip = state.project.entities.clips[clipId];
      if (!clip || clip.locked) return state;

      const updated = updater(clip);
      // Referential no-op guard: a scrub that lands on the same value must not
      // push an undo entry or mark the project dirty.
      if (updated === clip) return state;

      return commit(
        state,
        withDerived({
          ...state.project,
          entities: {
            ...state.project.entities,
            clips: { ...state.project.entities.clips, [clipId]: updated },
          },
        }),
        label,
        mergeKey,
      );
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

      return commit(
        state,
        withDerived({ ...state.project, entities: { ...state.project.entities, clips } }),
        "Split clip",
      );
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
        ...commit(
          state,
          withDerived({ ...state.project, entities: { ...state.project.entities, clips } }),
          "Delete clip",
        ),
      };
    }),

  addTrack: (kind) =>
    set((state) => {
      const existingOfKind = Object.values(state.project.entities.tracks).filter(
        (track) => track.kind === kind,
      ).length;
      const track = createTrack({ kind, index: existingOfKind });

      // Video tracks prepend (top of the timeline = drawn in front); audio
      // tracks append (bottom), keeping video grouped above audio like an NLE.
      const trackOrder =
        kind === "audio"
          ? [...state.project.trackOrder, track.id]
          : [track.id, ...state.project.trackOrder];

      return commit(
        state,
        {
          ...state.project,
          entities: {
            ...state.project.entities,
            tracks: { ...state.project.entities.tracks, [track.id]: track },
          },
          trackOrder,
          modifiedAt: Date.now(),
        },
        `Add ${kind} track`,
      );
    }),

  setTrackFlag: (trackId, flag, value) =>
    set((state) => {
      const track = state.project.entities.tracks[trackId];
      if (!track) return state;

      const updated: Track = { ...track, [flag]: value };
      return commit(
        state,
        {
          ...state.project,
          entities: {
            ...state.project.entities,
            tracks: { ...state.project.entities.tracks, [trackId]: updated },
          },
          modifiedAt: Date.now(),
        },
        `${value ? "Enable" : "Disable"} track ${flag}`,
      );
    }),

  replaceProject: (project) =>
    // View state is reset alongside the document: a playhead or selection
    // carried over from the previous project would point at clips that no
    // longer exist. History is discarded for the same reason — undoing across a
    // document swap would resurrect clips from a project no longer open.
    set({
      project,
      history: historyReset(project),
      playhead: 0,
      scrollFrame: 0,
      selectedClipIds: [],
      isPlaying: false,
      inPoint: null,
      outPoint: null,
    }),

  renameProject: (name) =>
    set((state) =>
      // Merged, so typing a name is one undo step rather than one per keystroke.
      commit(state, { ...state.project, name, modifiedAt: Date.now() }, "Rename project", "rename"),
    ),

  setAspectRatio: (id, resolution) =>
    set((state) =>
      commit(
        state,
        {
          ...state.project,
          settings: { ...state.project.settings, aspectRatio: id, resolution },
          modifiedAt: Date.now(),
        },
        `Aspect ratio ${id}`,
      ),
    ),

  endGesture: () => set((state) => ({ history: historySeal(state.history) })),

  undo: () =>
    set((state) => {
      if (!historyCanUndo(state.history)) return state;
      const history = historyUndo(state.history);

      // Selection is cleared rather than preserved: the clips it referenced may
      // not exist in the restored document, and a selection pointing at missing
      // ids breaks the properties panel.
      return { history, project: history.present.state, selectedClipIds: [] };
    }),

  redo: () =>
    set((state) => {
      if (!historyCanRedo(state.history)) return state;
      const history = historyRedo(state.history);
      return { history, project: history.present.state, selectedClipIds: [] };
    }),

  canUndo: () => historyCanUndo(get().history),
  canRedo: () => historyCanRedo(get().history),
  undoLabel: () => historyUndoLabel(get().history),
  redoLabel: () => historyRedoLabel(get().history),

  addMediaAssets: (assets) =>
    set((state) => {
      if (assets.length === 0) return state;

      const media = { ...state.project.entities.media };
      for (const asset of assets) media[asset.id] = asset;

      return commit(
        state,
        {
          ...state.project,
          entities: { ...state.project.entities, media },
          modifiedAt: Date.now(),
        },
        assets.length === 1 ? "Import media" : `Import ${assets.length} files`,
      );
    }),

  upsertCaptionTrack: (track, label) =>
    set((state) =>
      commit(
        state,
        withDerived({
          ...state.project,
          entities: {
            ...state.project.entities,
            captionTracks: { ...state.project.entities.captionTracks, [track.id]: track },
          },
        }),
        label,
      ),
    ),

  removeCaptionTrack: (trackId) =>
    set((state) => {
      const captionTracks = { ...state.project.entities.captionTracks };
      if (!captionTracks[trackId]) return state;
      delete captionTracks[trackId];

      return commit(
        state,
        withDerived({ ...state.project, entities: { ...state.project.entities, captionTracks } }),
        "Remove captions",
      );
    }),

  updateCaptionTrack: (trackId, updater, label, mergeKey) =>
    set((state) => {
      const track = state.project.entities.captionTracks[trackId];
      if (!track) return state;

      const updated = updater(track);
      if (updated === track) return state;

      return commit(
        state,
        withDerived({
          ...state.project,
          entities: {
            ...state.project.entities,
            captionTracks: { ...state.project.entities.captionTracks, [trackId]: updated },
          },
        }),
        label,
        mergeKey,
      );
    }),

  upsertMediaAsset: (asset) =>
    set((state) => {
      // Only applies to assets still present: a thumbnail finishing after the
      // user removed the asset must not resurrect it.
      if (!state.project.entities.media[asset.id]) return state;

      // Deliberately NOT committed to history. A thumbnail or waveform landing
      // is an async artifact of an import the user already performed, not an
      // action of theirs — an undo step for it would be unexplainable, and
      // pressing undo would appear to do nothing.
      const project: ProjectDocument = {
        ...state.project,
        entities: {
          ...state.project.entities,
          media: { ...state.project.entities.media, [asset.id]: asset },
        },
      };

      // The history's present entry is rewritten in place so its snapshot stays
      // identical to the live document; leaving it stale would make the next
      // undo silently discard the artifact.
      return {
        project,
        history: { ...state.history, present: { ...state.history.present, state: project } },
      };
    }),

  removeMediaAsset: (assetId) =>
    set((state) => {
      const media = { ...state.project.entities.media };
      if (!media[assetId]) return state;
      delete media[assetId];

      // Clips referencing the removed asset go with it — leaving them would
      // produce clips that can never render and cannot be explained to the user.
      const clips = Object.fromEntries(
        Object.entries(state.project.entities.clips).filter(
          ([, clip]) => !("mediaId" in clip.content) || clip.content.mediaId !== assetId,
        ),
      );

      return {
        selectedClipIds: [],
        ...commit(
          state,
          withDerived({ ...state.project, entities: { ...state.project.entities, media, clips } }),
          "Remove media",
        ),
      };
    }),

  addClipFromAsset: (assetId) =>
    set((state) => {
      const asset = state.project.entities.media[assetId];
      if (!asset) return state;

      const wantedKind = trackKindForAsset(asset);
      const tracks = { ...state.project.entities.tracks };
      let trackOrder = [...state.project.trackOrder];

      // Prefer an existing unlocked track of the right kind; create one only if
      // there is none, so repeated imports stack up rather than sprawling into
      // a new track per file.
      let target = trackOrder
        .map((id) => tracks[id])
        .find(
          (track): track is Track => Boolean(track) && track.kind === wantedKind && !track.locked,
        );

      if (!target) {
        target = createTrack({ kind: wantedKind, index: trackOrder.length });
        tracks[target.id] = target;
        trackOrder = [...trackOrder, target.id];
      }

      const trackClips = Object.values(state.project.entities.clips).filter(
        (clip) => clip.trackId === target.id,
      );
      const startFrame = computeDuration(trackClips);

      const clip = createClipForAsset({
        asset,
        trackId: target.id,
        startFrame,
        projectFrameRate: state.project.settings.frameRate,
        projectResolution: state.project.settings.resolution,
      });

      return {
        selectedClipIds: [clip.id],
        ...commit(
          state,
          withDerived({
            ...state.project,
            entities: {
              ...state.project.entities,
              tracks,
              clips: { ...state.project.entities.clips, [clip.id]: clip },
            },
            trackOrder,
          }),
          "Add clip",
        ),
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
