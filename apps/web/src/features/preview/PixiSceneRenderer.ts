"use client";

import { Application, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { Scene, SceneNode } from "@opencut/render-engine";
import type { ResolvedMask } from "@opencut/mask-engine";
import type { Id, MediaAsset } from "@opencut/types";
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
  private readonly cache: MediaTextureCache;

  private initialized = false;
  private lastResolution = { width: 0, height: 0 };
  /** Media ids requested but not yet decoded, so we ask only once. */
  private readonly requested = new Set<Id>();
  private onTextureReady: (() => void) | null = null;
  private isPlaying = false;

  constructor(cache: MediaTextureCache) {
    this.cache = cache;
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      // Cap at 2: beyond that the memory cost outweighs any visible gain on a
      // preview that is already scaled down from project resolution.
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
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
