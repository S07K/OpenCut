import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Workspace packages ship raw TypeScript rather than a build step — one less
   * thing to run, and edits to a package are reflected instantly in dev.
   * Next must therefore compile them itself.
   */
  transpilePackages: [
    "@cutaway/types",
    "@cutaway/utils",
    "@cutaway/timeline-engine",
    "@cutaway/media-engine",
    "@cutaway/animation-engine",
    "@cutaway/render-engine",
    "@cutaway/project-io",
    "@cutaway/playback-engine",
    "@cutaway/history-engine",
    "@cutaway/mask-engine",
    "@cutaway/caption-engine",
    "@cutaway/color-engine",
    "@cutaway/ui",
  ],
};

export default nextConfig;
