import type { Animatable, Clip, Vec2 } from "@cutaway/types";

/**
 * The registry of animatable clip properties.
 *
 * Each descriptor knows how to *read* an `Animatable<T>` off a clip and how to
 * *write* a modified one back. Everything that edits animation — the properties
 * panel, the keyframe dopesheet, the record-keyframe action — goes through this
 * one list, so a new animatable property is added in exactly one place and both
 * the panel and the timeline pick it up.
 *
 * The alternative, stringly-typed deep paths (`"transform.position.x"`) with a
 * `set`-by-path helper, was rejected: it defeats the type checker precisely
 * where a wrong path silently writes nothing, and animation bugs are miserable
 * to trace. Explicit get/set lambdas keep it type-safe.
 */

export type PropertyKind = "number" | "angle" | "unit" | "point" | "color";

export interface PropertyDescriptor {
  /** Stable id, unique within a clip. Doubles as the dopesheet row key. */
  id: string;
  label: string;
  group: "Transform" | "Appearance" | "Text" | "Shape";
  kind: PropertyKind;
  /** UI step for numeric drag/scrub; ignored for point/color. */
  step?: number;
  min?: number;
  max?: number;
  /** Reads the animatable off the clip, or null when absent for this kind. */
  get: (clip: Clip) => Animatable<unknown> | null;
  /** Returns a new clip with the animatable replaced. */
  set: (clip: Clip, value: Animatable<unknown>) => Clip;
}

/** Narrows and rewrites the transform, keeping the rest of the clip intact. */
function transformProp<K extends keyof Clip["transform"]>(
  key: K,
  descriptor: Omit<PropertyDescriptor, "get" | "set">,
): PropertyDescriptor {
  return {
    ...descriptor,
    get: (clip) => clip.transform[key] as Animatable<unknown>,
    set: (clip, value) => ({
      ...clip,
      transform: { ...clip.transform, [key]: value as Clip["transform"][K] },
    }),
  };
}

function appearanceProp<K extends keyof Clip["appearance"]>(
  key: K,
  descriptor: Omit<PropertyDescriptor, "get" | "set">,
): PropertyDescriptor {
  return {
    ...descriptor,
    get: (clip) => clip.appearance[key] as Animatable<unknown>,
    set: (clip, value) => ({
      ...clip,
      appearance: { ...clip.appearance, [key]: value as Clip["appearance"][K] },
    }),
  };
}

/** Properties every visual clip has, regardless of content kind. */
const COMMON_PROPERTIES: PropertyDescriptor[] = [
  transformProp("position", {
    id: "transform.position",
    label: "Position",
    group: "Transform",
    kind: "point",
    step: 1,
  }),
  transformProp("scale", {
    id: "transform.scale",
    label: "Scale",
    group: "Transform",
    kind: "point",
    step: 0.01,
  }),
  transformProp("rotation", {
    id: "transform.rotation",
    label: "Rotation",
    group: "Transform",
    kind: "angle",
    step: 1,
  }),
  transformProp("anchor", {
    id: "transform.anchor",
    label: "Anchor",
    group: "Transform",
    kind: "point",
    step: 0.01,
  }),
  appearanceProp("opacity", {
    id: "appearance.opacity",
    label: "Opacity",
    group: "Appearance",
    kind: "unit",
    step: 0.01,
    min: 0,
    max: 1,
  }),
  appearanceProp("blur", {
    id: "appearance.blur",
    label: "Blur",
    group: "Appearance",
    kind: "number",
    step: 0.5,
    min: 0,
  }),
  appearanceProp("cornerRadius", {
    id: "appearance.cornerRadius",
    label: "Corner radius",
    group: "Appearance",
    kind: "number",
    step: 1,
    min: 0,
  }),
];

/** Text-only animatable properties, appended for text clips. */
const TEXT_PROPERTIES: PropertyDescriptor[] = [
  {
    id: "content.fontSize",
    label: "Font size",
    group: "Text",
    kind: "number",
    step: 1,
    min: 1,
    get: (clip) => (clip.content.kind === "text" ? clip.content.fontSize : null),
    set: (clip, value) =>
      clip.content.kind === "text"
        ? { ...clip, content: { ...clip.content, fontSize: value as Animatable<number> } }
        : clip,
  },
  {
    id: "content.color",
    label: "Color",
    group: "Text",
    kind: "color",
    get: (clip) => (clip.content.kind === "text" ? clip.content.color : null),
    set: (clip, value) =>
      clip.content.kind === "text"
        ? { ...clip, content: { ...clip.content, color: value as Animatable<string> } }
        : clip,
  },
];

/**
 * The animatable properties available for a given clip.
 *
 * Audio clips have no visual transform, so they get an empty list — the panel
 * shows their volume through a dedicated control instead of the generic grid.
 */
export function propertiesForClip(clip: Clip): PropertyDescriptor[] {
  if (clip.content.kind === "audio") return [];

  const properties = [...COMMON_PROPERTIES];
  if (clip.content.kind === "text") properties.push(...TEXT_PROPERTIES);
  return properties;
}

/** Groups a clip's properties for sectioned rendering, preserving order. */
export function groupedProperties(
  clip: Clip,
): [PropertyDescriptor["group"], PropertyDescriptor[]][] {
  const order: PropertyDescriptor["group"][] = ["Transform", "Appearance", "Text", "Shape"];
  const byGroup = new Map<PropertyDescriptor["group"], PropertyDescriptor[]>();

  for (const property of propertiesForClip(clip)) {
    const list = byGroup.get(property.group) ?? [];
    list.push(property);
    byGroup.set(property.group, list);
  }

  return order
    .filter((group) => byGroup.has(group))
    .map((group) => [group, byGroup.get(group)!] as const);
}

/** Number of scalar components a property kind exposes. */
export function isPointKind(kind: PropertyKind): boolean {
  return kind === "point";
}

export type { Vec2 };
