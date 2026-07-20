/**
 * `@opencut/ui` — the shared design system.
 *
 * Deliberately small. Every primitive here is one that appears in three or more
 * places in the editor; anything less general belongs in the feature that uses
 * it. A design system that absorbs one-offs stops being a system.
 */

export { cn } from "./lib/cn";
export { Button, IconButton } from "./components/Button";
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from "./components/Button";
export { Panel } from "./components/Panel";
export type { PanelProps } from "./components/Panel";
export { SplitPane } from "./components/SplitPane";
export type { SplitPaneChild, SplitPaneProps } from "./components/SplitPane";
