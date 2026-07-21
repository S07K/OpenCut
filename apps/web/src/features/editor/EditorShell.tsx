"use client";

import { SplitPane } from "@opencut/ui";
import { TopToolbar } from "./TopToolbar";
import { LeftSidebar } from "./LeftSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { RightSidebar } from "./RightSidebar";
import { StatusBar } from "./StatusBar";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useProject } from "@/features/project/ProjectProvider";
import { usePlayback } from "@/features/playback/usePlayback";
import { TimelinePanel } from "@/features/timeline/TimelinePanel";
import { DropOverlay } from "@/features/media/DropOverlay";
import { MediaImportProvider } from "@/features/media/MediaImportProvider";
import { ProjectProvider } from "@/features/project/ProjectProvider";
import { LoadIssuesBanner } from "@/features/project/LoadIssuesBanner";

/**
 * The editor layout.
 *
 * Composed from nested `SplitPane`s rather than a bespoke docking manager:
 * a vertical split (workspace over timeline) whose top pane is a horizontal
 * split (sidebar / preview / inspector). Two primitives, arbitrary layouts,
 * and every divider is resizable and persistent for free.
 *
 * Full drag-to-rearrange docking is a Phase 6 concern. Getting there means
 * replacing the static `panes` arrays with a serialized layout tree — the
 * component boundaries here do not have to change.
 */
export function EditorShell() {
  return (
    <MediaImportProvider>
      <ProjectProvider>
        <EditorKeyboard />
        <div className="flex h-full w-full flex-col overflow-hidden">
          <TopToolbar />

          <div className="min-h-0 flex-1">
            <SplitPane
              direction="vertical"
              storageKey="root"
              panes={[
                {
                  id: "workspace",
                  defaultSize: 0.62,
                  minSize: 220,
                  content: (
                    <SplitPane
                      direction="horizontal"
                      storageKey="workspace"
                      panes={[
                        {
                          id: "left",
                          defaultSize: 0.2,
                          minSize: 220,
                          content: <LeftSidebar />,
                        },
                        {
                          id: "center",
                          defaultSize: 0.56,
                          minSize: 320,
                          content: <PreviewPanel />,
                        },
                        {
                          id: "right",
                          defaultSize: 0.24,
                          minSize: 240,
                          content: <RightSidebar />,
                        },
                      ]}
                    />
                  ),
                },
                {
                  id: "timeline",
                  defaultSize: 0.38,
                  minSize: 180,
                  content: <TimelinePanel />,
                },
              ]}
            />
          </div>

          <StatusBar />
          <DropOverlay />
          <LoadIssuesBanner />
        </div>
      </ProjectProvider>
    </MediaImportProvider>
  );
}

/**
 * Binds global shortcuts.
 *
 * A component rather than a hook call in `EditorShell`, because the shortcuts
 * need the persistence context — and `EditorShell` is what renders the provider,
 * so it cannot consume it.
 */
function EditorKeyboard() {
  const { saveNow } = useProject();
  useKeyboardShortcuts(() => void saveNow());
  usePlayback();
  return null;
}
