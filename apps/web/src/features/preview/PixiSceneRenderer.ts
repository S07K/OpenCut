"use client";

import {
  Application,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  type Filter,
  Graphics,
  NoiseFilter,
  Sprite,
  Text,
  TextStyle,
} from "pixi.js";
import type { Scene, SceneNode } from "@cutaway/render-engine";
import type { ResolvedEffect } from "@cutaway/effects-engine";
import {
  EFFECT_BLUR,
  EFFECT_CHROMA,
  EFFECT_GRAYSCALE,
  EFFECT_HUE,
  EFFECT_INVERT,
  EFFECT_NOISE,
  EFFECT_SEPIA,
} from "@cutaway/effects-engine";
import { ChromaKeyFilter } from "./ChromaKeyFilter";
import type { ResolvedMask } from "@cutaway/mask-engine";
import type { Id, MediaAsset } from "@cutaway/types";
import { MediaTextureCache } from "./MediaTextureCache";

/**
 * PixiJS backend for the resolved scene.
 *
 * This class knows *how* to draw; `resolveScene` decided *what*. Keeping that
 * line sharp is what lets the export path reuse the resolver with a completely
 * different backend later.
 *
 * Display objects are reconciled by clip id rather than rebuilt each frame.
 * Tearing down and recreating the stage sixty times a second would thrash the
 * GPU and lose texture state; reconciliation keeps steady-state cost to
 * property assignment.
 */

/**
 * Coordinate convention: the stage origin sits at the **centre** of the frame.
 *
 * A clip's default position of `{x: 0, y: 0}` therefore lands centred, which is
 * what a creator expects when dropping in footage. A top-left origin would put
 * every new object in the corner, half off-screen.
 */
export class PixiSceneRenderer {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly nodes = new Map<Id, Container>();
  /** Per-node mask graphic, kept so it can be reused and torn down cleanly. */
  private readonly maskGraphics = new Map<Id, Graphics>();
  /** Per-node colour-grade filter, reused across frames. */
  private readonly gradeFilters = new Map<Id, ColorMatrixFilter>();
  /** Per-node effect filters, aligned to the node's effect stack order. */
  private readonly effectFilters = new Map<Id, Filter[]>();
  /** The effect-stack shape (ids joined) a node's effect filters were built for. */
  private readonly effectKeys = new Map<Id, string>();
  /**
   * The effect-stack shape a node's filters were last built for (its effect ids
   * joined). When it changes, the filter objects are rebuilt; otherwise only
   * their parameters are updated, keeping steady-state cost to assignment.
   */
  private readonly filterKeys = new Map<Id, string>();
  private readonly cache: MediaTextureCache;

  private initialized = false;
  private lastResolution = { width: 0, height: 0 };
  /** Media ids requested but not yet decoded, so we ask only once. */
  private readonly requested = new Set<Id>();
  private onTextureReady: (() => void) | null = null;
  private isPlaying = false;
  /** Always-on-top container for the caption overlay. */
  private captionContainer: Container | null = null;

  constructor(cache: MediaTextureCache) {
    this.cache = cache;
  }

  /**
   * Initialises the renderer against a canvas.
   *
   * `pixelRatio` defaults to the display density (capped at 2) for a crisp
   * preview. Export passes `1` so the backing store is exactly the project
   * resolution — an exported frame must be the requested pixel size, never
   * scaled by whatever display the export happened to run on.
   */
  async init(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2),
  ): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: pixelRatio,
      autoDensity: true,
      preference: "webgl",
    });

    // The render loop is driven by scene updates, not by a ticker. A paused
    // editor should burn no GPU at all.
    this.app.ticker.stop();
    this.app.stage.addChild(this.root);
    this.initialized = true;
  }

  setTextureReadyCallback(callback: () => void): void {
    this.onTextureReady = callback;
  }

  resize(width: number, height: number): void {
    if (!this.initialized) return;
    this.app.renderer.resize(width, height);
  }

  /**
   * Snapshots the current canvas as a `VideoFrame` for the exporter.
   *
   * Reads the backing store directly, so it captures exactly what was last
   * rendered — the same pixels the preview would show at full resolution. The
   * caller owns the returned frame and must `close()` it.
   */
  captureFrame(timestampMicros: number, durationMicros: number): VideoFrame {
    return new VideoFrame(this.app.canvas as unknown as HTMLCanvasElement, {
      timestamp: timestampMicros,
      duration: durationMicros,
    });
  }

  /**
   * Draws a scene.
   *
   * `assets` supplies the blob keys the scene's media ids refer to; the scene
   * itself deliberately carries no storage detail.
   */
  render(
    scene: Scene,
    assets: Record<Id, MediaAsset>,
    displayWidth: number,
    isPlaying = false,
  ): void {
    if (!this.initialized) return;
    this.isPlaying = isPlaying;

    // The preview canvas is smaller than the project frame, so the whole scene
    // is drawn at project scale and then scaled down as a unit. Every position
    // in the document stays in project pixels, at any preview size.
    const scale = displayWidth / scene.resolution.width;
    this.root.scale.set(scale);
    this.root.position.set(
      (scene.resolution.width * scale) / 2,
      (scene.resolution.height * scale) / 2,
    );

    this.lastResolution = scene.resolution;

    const seen = new Set<Id>();

    for (const node of scene.nodes) {
      seen.add(node.clipId);
      this.syncNode(node, assets);
    }

    // Remove display objects whose clips left the frame.
    for (const [clipId, container] of this.nodes) {
      if (seen.has(clipId)) continue;
      // The mask graphic is a child, so destroying with children reaps it too;
      // just drop the map entry so it is not reused against a destroyed object.
      this.maskGraphics.delete(clipId);
      this.gradeFilters.delete(clipId);
      this.effectFilters.get(clipId)?.forEach((f) => f.destroy());
      this.effectFilters.delete(clipId);
      this.effectKeys.delete(clipId);
      this.filterKeys.delete(clipId);
      container.destroy({ children: true });
      this.nodes.delete(clipId);
    }

    // Draw order: zIndex is already sorted by the resolver, so index order in
    // the children array is authoritative.
    scene.nodes.forEach((node, index) => {
      const container = this.nodes.get(node.clipId);
      if (container)
        this.root.setChildIndex(container, Math.min(index, this.root.children.length - 1));
    });

    this.syncCaption(scene);

    this.app.renderer.render(this.app.stage);
  }

  private syncNode(node: SceneNode, assets: Record<Id, MediaAsset>): void {
    let container = this.nodes.get(node.clipId);

    if (!container) {
      const created = this.createDisplayObject(node, assets);
      if (!created) return;
      container = created;
      this.nodes.set(node.clipId, container);
      this.root.addChild(container);
    }

    this.applyTransform(container, node);
    this.updateContent(container, node, assets);
    this.applyMasks(container, node);
    this.applyFilters(container, node);
  }

  /**
   * Applies the node's colour grade and effect stack as Pixi filters.
   *
   * Grade and effects share one filters array — the grade runs first (colour is
   * a property of the source), then effects in stack order. The array is only
   * reassigned when its membership changes (the grade toggles or the effect
   * shape changes); otherwise filter parameters are updated in place, so a
   * steady-state frame costs assignment, not allocation. The filter *objects*
   * are reused across frames and torn down with the node.
   */
  private applyFilters(content: Container, node: SceneNode): void {
    const grade = this.syncGradeFilter(node);
    const effects = this.syncEffectFilters(node);

    // Reassign the array only when membership changes; params update in place.
    const key = `${grade ? "g" : "-"}|${node.effects.map((e) => e.effectId).join(",")}`;
    if (this.filterKeys.get(node.clipId) !== key) {
      const filters = grade ? [grade, ...effects] : effects;
      // `null`, not an empty array: an empty filter list still triggers a filter
      // render pass in Pixi, which renders the object black when it is also
      // masked. `null` skips the pass entirely.
      content.filters = filters.length > 0 ? filters : null;
      this.filterKeys.set(node.clipId, key);
    }
  }

  /**
   * Reconciles the node's colour grade into its ColorMatrixFilter, returning the
   * filter or null when the clip has no grade.
   *
   * The scene resolver hands over a fully-numeric grade (or null for neutral),
   * so this stays a dumb mapping onto filter methods. Covers the high-impact
   * controls — exposure/brightness, contrast, saturation — via Pixi's built-in
   * colour matrix. Temperature/tint, tonal split (shadows/highlights), wheels,
   * curves, vignette, and grain need a custom shader and are a documented
   * refinement; leaving them out renders a *subset* of the grade, never a wrong
   * one.
   */
  private syncGradeFilter(node: SceneNode): ColorMatrixFilter | null {
    if (!node.grade) {
      this.gradeFilters.delete(node.clipId);
      return null;
    }

    const filter = this.gradeFilters.get(node.clipId) ?? new ColorMatrixFilter();
    const grade = node.grade;

    // Compose from a clean identity each frame so values are absolute, not
    // accumulated across ticks.
    filter.reset();
    // Exposure and brightness both scale luminance; 0 stays 1×.
    filter.brightness(1 + grade.exposure * 0.6 + grade.brightness * 0.5, true);
    filter.contrast(grade.contrast, true);
    filter.saturate(grade.saturation, true);

    this.gradeFilters.set(node.clipId, filter);
    return filter;
  }

  /**
   * Reconciles the node's effect stack into its filter list.
   *
   * Filters are rebuilt only when the stack's shape changes (an effect added,
   * removed, or reordered); otherwise the existing objects are reused and their
   * parameters updated for this frame. Effect ids the compositor cannot draw are
   * skipped rather than faked — the documented degradation for an effect whose
   * plugin renderer is absent.
   */
  private syncEffectFilters(node: SceneNode): Filter[] {
    const key = node.effects.map((e) => e.effectId).join(",");
    let filters = this.effectFilters.get(node.clipId);

    if (!filters || this.effectKeys.get(node.clipId) !== key) {
      filters?.forEach((f) => f.destroy());
      filters = node.effects
        .map((effect) => this.createEffectFilter(effect))
        .filter((f): f is Filter => f !== null);
      this.effectFilters.set(node.clipId, filters);
      this.effectKeys.set(node.clipId, key);
    }

    // Parameters are updated every frame so animated effect values track the
    // playhead; the array indices line up with the drawable effects.
    let i = 0;
    for (const effect of node.effects) {
      const filter = filters[i];
      if (filter) {
        this.updateEffectFilter(filter, effect);
        i += 1;
      }
    }

    return filters;
  }

  private createEffectFilter(effect: ResolvedEffect): Filter | null {
    switch (effect.effectId) {
      case EFFECT_BLUR:
        return new BlurFilter();
      case EFFECT_NOISE:
        return new NoiseFilter();
      case EFFECT_CHROMA:
        return new ChromaKeyFilter();
      // Sepia, grayscale, invert, and hue are all one colour matrix; the update
      // step composes the right one from the effect id.
      case EFFECT_SEPIA:
      case EFFECT_GRAYSCALE:
      case EFFECT_INVERT:
      case EFFECT_HUE:
        return new ColorMatrixFilter();
      default:
        return null;
    }
  }

  private updateEffectFilter(filter: Filter, effect: ResolvedEffect): void {
    if (filter instanceof BlurFilter) {
      // Normalised strength maps to a pixel radius; 40px is a heavy blur.
      filter.strength = Number(effect.params.strength ?? 0) * 40;
    } else if (filter instanceof NoiseFilter) {
      filter.noise = Number(effect.params.amount ?? 0);
    } else if (filter instanceof ChromaKeyFilter) {
      filter.keyColor = hexToRgb(String(effect.params.color ?? "#00ff00"));
      filter.similarity = Number(effect.params.similarity ?? 0.4);
      filter.smoothness = Number(effect.params.smoothness ?? 0.1);
    } else if (filter instanceof ColorMatrixFilter) {
      // Rebuild from identity each frame so the matrix is absolute; `alpha`
      // blends the effect with the original, driving the Amount slider.
      filter.reset();
      const amount = Number(effect.params.amount ?? 1);
      switch (effect.effectId) {
        case EFFECT_SEPIA:
          filter.sepia(true);
          filter.alpha = amount;
          break;
        case EFFECT_GRAYSCALE:
          filter.desaturate();
          filter.alpha = amount;
          break;
        case EFFECT_INVERT:
          filter.negative(true);
          filter.alpha = amount;
          break;
        case EFFECT_HUE:
          filter.hue(Number(effect.params.degrees ?? 0), true);
          filter.alpha = 1;
          break;
      }
    }
  }

  /**
   * Applies the node's resolved masks to its content.
   *
   * The mask is a Graphics child of the content object, so it inherits the
   * content's transform and stays glued to it as the clip moves, scales, or
   * rotates. Mask polygons are in the node's local space; a factory-created mask
   * centred at (0,0) therefore clips around the content's centre (which assumes
   * the default 0.5 anchor — refined when the drawing overlay lands).
   *
   * This increment covers the common cases: an additive union of "add" masks,
   * and a single inverted mask cut as a hole. `subtract`/`intersect` across
   * multiple masks and `feather` need a render-texture pass and are deferred;
   * they degrade to an additive union rather than rendering wrong.
   */
  private applyMasks(content: Container, node: SceneNode): void {
    const existing = this.maskGraphics.get(node.clipId);

    if (node.masks.length === 0) {
      if (existing) {
        content.mask = null;
        content.removeChild(existing);
        existing.destroy();
        this.maskGraphics.delete(node.clipId);
      }
      return;
    }

    let graphic = existing;
    if (!graphic) {
      graphic = new Graphics();
      content.addChild(graphic);
      this.maskGraphics.set(node.clipId, graphic);
    }

    graphic.clear();
    this.drawMaskGeometry(graphic, node.masks);
    // A mask object is not itself drawn; Pixi uses it as a stencil.
    content.mask = graphic;
  }

  private drawMaskGeometry(graphic: Graphics, masks: readonly ResolvedMask[]): void {
    const single = masks.length === 1 ? masks[0]! : null;

    if (single?.inverted) {
      // Everything except the polygon shows: fill a frame-spanning rect, then
      // cut the polygon out of it.
      const extent = 100_000;
      graphic.rect(-extent, -extent, extent * 2, extent * 2).fill(0xffffff);
      graphic.poly(flattenPolygon(single.polygon)).cut();
      return;
    }

    // Additive union: every polygon that reveals content is filled. Subtract/
    // intersect are treated as additive for now (documented above).
    for (const mask of masks) {
      if (mask.inverted || mask.polygon.length < 3) continue;
      graphic.poly(flattenPolygon(mask.polygon)).fill(0xffffff);
    }
  }

  private createDisplayObject(node: SceneNode, assets: Record<Id, MediaAsset>): Container | null {
    switch (node.content.kind) {
      case "media": {
        const texture = this.cache.peek(node.content.mediaId);
        this.requestTexture(node.content.mediaId, node.content.mediaKind, assets);
        // A placeholder sprite is created even before the texture resolves, so
        // the node participates in ordering and does not pop in out of order.
        return new Sprite(texture ?? undefined);
      }

      case "text":
        return new Text({ text: node.content.text.text, style: this.textStyle(node) });

      case "emoji":
        return new Text({
          text: node.content.emoji,
          style: new TextStyle({ fontSize: node.content.size }),
        });

      case "shape":
        return new Graphics();

      default:
        // SVG and plugin content are not renderable yet. Returning null leaves
        // a hole rather than crashing, which is the documented degradation for
        // a project opened without its plugin.
        return null;
    }
  }

  private requestTexture(
    mediaId: Id,
    kind: "video" | "image" | "gif",
    assets: Record<Id, MediaAsset>,
  ): void {
    if (this.requested.has(mediaId) || this.cache.peek(mediaId)) return;

    const asset = assets[mediaId];
    if (!asset || asset.source.type !== "indexeddb") return;

    this.requested.add(mediaId);
    void this.cache.load(mediaId, asset.source.key, kind).then((texture) => {
      // Decoding is async, so the frame that requested this texture has already
      // been drawn without it. Ask for a redraw now that it exists.
      if (texture) this.onTextureReady?.();
    });
  }

  private textStyle(node: SceneNode): TextStyle {
    if (node.content.kind !== "text") return new TextStyle();
    const text = node.content.text;

    return new TextStyle({
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      fontWeight: String(text.fontWeight) as TextStyle["fontWeight"],
      fontStyle: text.italic ? "italic" : "normal",
      fill: text.color,
      align: text.align,
      lineHeight: text.fontSize * text.lineHeight,
      letterSpacing: text.letterSpacing,
      stroke: text.stroke.enabled
        ? { color: text.stroke.color, width: text.stroke.width, join: "round" }
        : undefined,
      wordWrap: text.maxWidth !== null,
      wordWrapWidth: text.maxWidth ?? 0,
    });
  }

  private applyTransform(container: Container, node: SceneNode): void {
    const { transform, appearance } = node;

    container.position.set(transform.position.x, transform.position.y);
    container.scale.set(transform.scale.x, transform.scale.y);
    // The document stores degrees because that is what the UI shows; Pixi wants
    // radians. Converting here keeps the conversion in exactly one place.
    container.rotation = (transform.rotation * Math.PI) / 180;
    container.alpha = appearance.opacity;
    container.skew.set(transform.skew.x, transform.skew.y);

    if (container instanceof Sprite) {
      container.anchor.set(transform.anchor.x, transform.anchor.y);
    } else if (container instanceof Text) {
      container.anchor.set(transform.anchor.x, transform.anchor.y);
    } else {
      // Graphics has no anchor; approximate by offsetting the pivot to its
      // measured bounds so rotation still happens about the intended point.
      const bounds = container.getLocalBounds();
      container.pivot.set(bounds.width * transform.anchor.x, bounds.height * transform.anchor.y);
    }
  }

  private updateContent(
    container: Container,
    node: SceneNode,
    assets: Record<Id, MediaAsset>,
  ): void {
    switch (node.content.kind) {
      case "media": {
        if (!(container instanceof Sprite)) return;

        const texture = this.cache.peek(node.content.mediaId);
        if (texture && container.texture !== texture) container.texture = texture;
        else if (!texture)
          this.requestTexture(node.content.mediaId, node.content.mediaKind, assets);

        if (node.content.mediaKind === "video") {
          this.syncVideoTime(node.content.mediaId, node.content.sourceTimeSeconds);
        }
        return;
      }

      case "text": {
        if (!(container instanceof Text)) return;
        if (container.text !== node.content.text.text) container.text = node.content.text.text;
        container.style = this.textStyle(node);
        return;
      }

      case "shape": {
        if (!(container instanceof Graphics)) return;
        this.drawShape(container, node);
        return;
      }

      default:
        return;
    }
  }

  /**
   * Aligns a video element to the playhead.
   *
   * Two different jobs depending on transport state:
   *
   * - **Scrubbing.** The element stays paused and is seeked precisely, because
   *   the user is looking for an exact frame.
   * - **Playing.** The element plays under its own decoder and is only nudged
   *   when it drifts badly. Assigning `currentTime` every frame would fight
   *   that decoder and produce a stutter far worse than the drift it corrects.
   *
   * Video chases audio here; it is never the timebase.
   */
  private syncVideoTime(mediaId: Id, targetSeconds: number): void {
    const element = this.cache.getVideoElement(mediaId);
    if (!element || !Number.isFinite(targetSeconds)) return;

    const drift = Math.abs(element.currentTime - targetSeconds);

    if (!this.isPlaying) {
      if (!element.paused) element.pause();
      if (drift > 1 / 120) element.currentTime = Math.max(0, targetSeconds);
      return;
    }

    if (element.paused) {
      element.currentTime = Math.max(0, targetSeconds);
      // Autoplay can still be refused; the frame simply stays where it is.
      void element.play().catch(() => undefined);
      return;
    }

    // Generous threshold: only correct drift a viewer would actually notice.
    if (drift > 0.25) element.currentTime = Math.max(0, targetSeconds);
  }

  private drawShape(graphics: Graphics, node: SceneNode): void {
    if (node.content.kind !== "shape") return;
    const shape = node.content.shape;

    graphics.clear();
    const { width, height } = { width: shape.size.x, height: shape.size.y };

    switch (shape.shape) {
      case "ellipse":
        graphics.ellipse(0, 0, width / 2, height / 2);
        break;
      case "rectangle":
      default:
        graphics.rect(-width / 2, -height / 2, width, height);
        break;
    }

    graphics.fill(shape.fill);
    if (shape.stroke.enabled) {
      graphics.stroke({ color: shape.stroke.color, width: shape.stroke.width });
    }
  }

  /**
   * Draws the caption overlay above every node.
   *
   * Kept in its own always-on-top container so captions never interleave with
   * clip z-order. The active word is a separate tinted Text so only it recolours
   * as the playhead advances — the karaoke effect — without restyling the line.
   */
  private syncCaption(scene: Scene): void {
    if (!scene.caption) {
      if (this.captionContainer) this.captionContainer.visible = false;
      return;
    }

    if (!this.captionContainer) {
      this.captionContainer = new Container();
      this.root.addChild(this.captionContainer);
    }
    const container = this.captionContainer;
    container.visible = true;
    // Always last child, so it sits above all clips regardless of node churn.
    this.root.setChildIndex(container, this.root.children.length - 1);
    container.removeChildren().forEach((child) => child.destroy());

    const { preset, words } = scene.caption;
    const gap = preset.fontSize * 0.28;

    // Build each word as its own Text so the active one can be tinted, then lay
    // them out on a single centred line.
    const parts = words.map((word) => {
      const text = new Text({
        text: preset.uppercase ? word.text.toUpperCase() : word.text,
        style: new TextStyle({
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontWeight: String(preset.fontWeight) as TextStyle["fontWeight"],
          fill: word.active ? preset.activeWordColor : preset.color,
          stroke: preset.stroke.enabled
            ? { color: preset.stroke.color, width: preset.stroke.width, join: "round" }
            : undefined,
          dropShadow: preset.shadow.enabled
            ? {
                color: preset.shadow.color,
                blur: preset.shadow.blur,
                distance: preset.shadow.offsetY,
                angle: Math.PI / 2,
                alpha: 1,
              }
            : undefined,
        }),
      });
      return text;
    });

    const totalWidth = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);
    const { width, height } = this.lastResolution;

    // Frame origin is the centre, so x starts at minus half the line width.
    let x = -totalWidth / 2;
    const y = (preset.positionY - 0.5) * height;

    for (const part of parts) {
      part.position.set(x, y);
      container.addChild(part);
      x += part.width + gap;
    }
    void width; // reserved for future word-wrap across the frame width
  }

  get projectResolution(): { width: number; height: number } {
    return this.lastResolution;
  }

  destroy(): void {
    if (!this.initialized) return;
    this.initialized = false;

    // `removeView` MUST stay false. The canvas element belongs to React, and
    // letting Pixi remove it from the DOM means React's next mount renders into
    // a detached node — the preview then silently disappears, which is exactly
    // what StrictMode's double-mount triggers in development.
    this.app.destroy({ removeView: false }, { children: true });
  }
}

/** Flattens a polygon to the [x0, y0, x1, y1, …] array Pixi's `poly` expects. */
function flattenPolygon(polygon: readonly { x: number; y: number }[]): number[] {
  const flat: number[] = [];
  for (const point of polygon) flat.push(point.x, point.y);
  return flat;
}

/** Parses a `#rrggbb` hex colour to normalised 0..1 RGB for a shader uniform. */
function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
