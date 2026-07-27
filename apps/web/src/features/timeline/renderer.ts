import type { Frame, Id, Marker } from "@opencut/types";
import { formatTimecode } from "@opencut/timeline-engine";
import {
  chooseTickInterval,
  frameToX,
  RULER_HEIGHT,
  type ClipRect,
  type TimelineViewport,
  type TrackLayout,
} from "./geometry";

/**
 * Canvas timeline renderer.
 *
 * A plain function of (state) -> pixels. It reads no store, holds no state, and
 * imports no React. Redrawing is therefore always safe and always cheap, which
 * is what lets the component redraw on every animation frame during a drag
 * without reasoning about staleness.
 *
 * Colors are read from CSS custom properties rather than hardcoded, so the
 * canvas honours the same design tokens as the DOM and follows theme changes
 * for free.
 */

export interface TimelineTheme {
  background: string;
  rulerBackground: string;
  rulerText: string;
  gridLine: string;
  trackBackground: string;
  trackBackgroundAlt: string;
  clipText: string;
  selection: string;
  playhead: string;
  snapGuide: string;
  clipColors: Record<string, string>;
}

/** Reads the current token values off an element's computed style. */
export function readTheme(element: HTMLElement): TimelineTheme {
  const styles = getComputedStyle(element);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    background: token("--color-surface-base", "#1c1d22"),
    rulerBackground: token("--color-surface-panel", "#26272d"),
    rulerText: token("--color-text-tertiary", "#8b8d98"),
    gridLine: token("--color-border-subtle", "#33343b"),
    trackBackground: token("--color-surface-panel", "#26272d"),
    trackBackgroundAlt: token("--color-surface-input", "#191a1f"),
    clipText: token("--color-text-primary", "#f4f4f6"),
    selection: token("--color-accent", "#6b7cff"),
    playhead: token("--color-accent", "#6b7cff"),
    snapGuide: token("--color-warning", "#e0a44a"),
    clipColors: {
      video: token("--color-clip-video", "#5b6ee0"),
      audio: token("--color-clip-audio", "#3fae7a"),
      text: token("--color-clip-text", "#d9a441"),
      image: token("--color-clip-image", "#c063c0"),
      gif: token("--color-clip-image", "#c063c0"),
      shape: token("--color-clip-shape", "#3fa3ae"),
      svg: token("--color-clip-shape", "#3fa3ae"),
      sticker: token("--color-clip-image", "#c063c0"),
      emoji: token("--color-clip-text", "#d9a441"),
      plugin: token("--color-text-tertiary", "#8b8d98"),
    },
  };
}

export interface RenderTimelineArgs {
  ctx: CanvasRenderingContext2D;
  viewport: TimelineViewport;
  layouts: readonly TrackLayout[];
  clipRects: readonly ClipRect[];
  markers: readonly Marker[];
  playhead: Frame;
  selectedClipIds: readonly Id[];
  /** Frame of the active snap guide during a drag, if any. */
  snapGuideFrame: Frame | null;
  /**
   * Keyframe times to draw on the selected clip, when exactly one clip with
   * animation is selected. `null` otherwise.
   */
  keyframes: { clipId: Id; frames: readonly Frame[] } | null;
  fps: number;
  theme: TimelineTheme;
}

export function renderTimeline(args: RenderTimelineArgs): void {
  const { ctx, viewport, theme } = args;

  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawTrackLanes(args);
  drawGridLines(args);
  drawClips(args);
  drawKeyframes(args);
  drawRuler(args);
  drawMarkers(args);
  drawSnapGuide(args);
  drawPlayhead(args);
}

/**
 * Draws keyframe diamonds along the bottom edge of the selected clip.
 *
 * Drawn after the clips so the diamonds sit on top of the clip fill, and before
 * the ruler and playhead so those chrome elements always win visually.
 */
function drawKeyframes({ ctx, keyframes, clipRects, viewport, theme }: RenderTimelineArgs): void {
  if (!keyframes) return;

  const rect = clipRects.find((candidate) => candidate.clip.id === keyframes.clipId);
  if (!rect) return;

  const y = rect.y + rect.height - 6;
  const size = 3.5;

  for (const frame of keyframes.frames) {
    const x = frameToX(frame, viewport);
    if (x < rect.x - size || x > rect.x + rect.width + size) continue;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = theme.clipText;
    ctx.strokeStyle = theme.background;
    ctx.lineWidth = 1;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  }
}

function drawTrackLanes({ ctx, layouts, viewport, theme }: RenderTimelineArgs): void {
  layouts.forEach((layout, index) => {
    ctx.fillStyle = index % 2 === 0 ? theme.trackBackground : theme.trackBackgroundAlt;
    ctx.fillRect(0, layout.top, viewport.width, layout.height);

    if (layout.track.hidden || layout.track.muted) {
      // A wash rather than reduced clip opacity: the lane reads as disabled
      // even where it is empty, which is where the user looks to re-enable it.
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(0, layout.top, viewport.width, layout.height);
    }
  });
}

function drawGridLines({ ctx, viewport, theme, fps }: RenderTimelineArgs): void {
  const interval = chooseTickInterval(viewport.pixelsPerFrame, fps);
  const firstTick = Math.floor(viewport.scrollFrame / interval) * interval;

  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let frame = firstTick; ; frame += interval) {
    const x = frameToX(frame, viewport);
    if (x > viewport.width) break;
    if (x < 0) continue;

    // The 0.5 offset lands the stroke on a device pixel instead of straddling
    // two, which is the difference between a crisp 1px line and a blurry 2px one.
    const snapped = Math.round(x) + 0.5;
    ctx.moveTo(snapped, RULER_HEIGHT);
    ctx.lineTo(snapped, viewport.height);
  }

  ctx.stroke();
}

function drawRuler({ ctx, viewport, theme, fps }: RenderTimelineArgs): void {
  ctx.fillStyle = theme.rulerBackground;
  ctx.fillRect(0, 0, viewport.width, RULER_HEIGHT);

  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_HEIGHT - 0.5);
  ctx.lineTo(viewport.width, RULER_HEIGHT - 0.5);
  ctx.stroke();

  const interval = chooseTickInterval(viewport.pixelsPerFrame, fps);
  const firstTick = Math.floor(viewport.scrollFrame / interval) * interval;

  ctx.fillStyle = theme.rulerText;
  ctx.font = '10px ui-monospace, "SF Mono", monospace';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.strokeStyle = theme.gridLine;
  ctx.beginPath();

  for (let frame = firstTick; ; frame += interval) {
    const x = frameToX(frame, viewport);
    if (x > viewport.width) break;
    if (x < -60) continue;

    const snapped = Math.round(x) + 0.5;
    ctx.moveTo(snapped, RULER_HEIGHT - 6);
    ctx.lineTo(snapped, RULER_HEIGHT);

    if (frame >= 0) {
      ctx.fillText(formatTimecode(frame, fps), snapped + 4, RULER_HEIGHT / 2 - 1);
    }
  }

  ctx.stroke();
}

function drawClips(args: RenderTimelineArgs): void {
  const { ctx, clipRects, selectedClipIds, theme } = args;
  const selected = new Set(selectedClipIds);

  for (const rect of clipRects) {
    const isSelected = selected.has(rect.clip.id);
    drawClip(ctx, rect, isSelected, theme);
  }
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  rect: ClipRect,
  isSelected: boolean,
  theme: TimelineTheme,
): void {
  const { clip } = rect;
  const color = theme.clipColors[clip.content.kind] ?? theme.clipColors.video ?? "#5b6ee0";

  const x = Math.round(rect.x);
  const y = Math.round(rect.y) + 1;
  const width = Math.max(2, Math.round(rect.width));
  const height = rect.height - 2;
  const radius = Math.min(4, width / 2);

  ctx.save();

  if (clip.hidden) ctx.globalAlpha = 0.4;

  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();

  // A darker band at the bottom gives the clip a readable base edge against
  // the lane behind it without needing a full border.
  ctx.globalAlpha *= 0.25;
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y + height - 3, width, 3);
  ctx.globalAlpha = clip.hidden ? 0.4 : 1;

  if (isSelected) {
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, width - 2, height - 2, radius);
    ctx.stroke();
  }

  // Labels are skipped rather than clipped on narrow clips: a truncated
  // one-character label is noise, not information.
  if (width > 36) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 6, y, width - 12, height);
    ctx.clip();

    ctx.fillStyle = theme.clipText;
    // Canvas `font` does not resolve CSS custom properties — it needs a
    // literal family list, so the token cannot be reused here.
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(clip.name, x + 6, y + 5);
    ctx.restore();
  }

  if (clip.locked && width > 16) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("🔒", x + width - 4, y + 4);
  }

  ctx.restore();
}

function drawMarkers({ ctx, markers, viewport }: RenderTimelineArgs): void {
  for (const marker of markers) {
    const x = frameToX(marker.frame, viewport);
    if (x < -10 || x > viewport.width + 10) continue;

    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT - 10);
    ctx.lineTo(x + 5, RULER_HEIGHT - 4);
    ctx.lineTo(x - 5, RULER_HEIGHT - 4);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSnapGuide({ ctx, snapGuideFrame, viewport, theme }: RenderTimelineArgs): void {
  if (snapGuideFrame === null) return;

  const x = Math.round(frameToX(snapGuideFrame, viewport)) + 0.5;
  ctx.strokeStyle = theme.snapGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, viewport.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPlayhead({ ctx, playhead, viewport, theme }: RenderTimelineArgs): void {
  const x = Math.round(frameToX(playhead, viewport)) + 0.5;
  if (x < -8 || x > viewport.width + 8) return;

  ctx.strokeStyle = theme.playhead;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, viewport.height);
  ctx.stroke();

  // The head is drawn wide enough to be grabbed, not just seen.
  ctx.fillStyle = theme.playhead;
  ctx.beginPath();
  ctx.moveTo(x - 6, 0);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x + 6, 10);
  ctx.lineTo(x, 16);
  ctx.lineTo(x - 6, 10);
  ctx.closePath();
  ctx.fill();
}
