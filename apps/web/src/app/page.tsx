import { EditorShell } from "@/features/editor/EditorShell";

/**
 * The editor is the product, so it lives at `/`.
 *
 * There is no landing page and no sign-in gate by design: `pnpm dev`, open
 * localhost, start editing.
 */
export default function EditorPage() {
  return <EditorShell />;
}
