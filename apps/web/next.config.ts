import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Workspace packages ship raw TypeScript rather than a build step — one less
   * thing to run, and edits to a package are reflected instantly in dev.
   * Next must therefore compile them itself.
   */
  transpilePackages: [
    "@opencut/types",
    "@opencut/utils",
    "@opencut/timeline-engine",
    "@opencut/media-engine",
    "@opencut/animation-engine",
    "@opencut/render-engine",
    "@opencut/project-io",
    "@opencut/playback-engine",
    "@opencut/ui",
  ],
};

export default nextConfig;
