"use client";

import { useEffect, useState } from "react";
import type { MediaBlobStore } from "@cutaway/media-engine";

/**
 * Resolves a stored blob to an object URL for the lifetime of the component.
 *
 * The revoke in the cleanup is the important part. Object URLs pin their blob
 * in memory until revoked, so a media library that scrolls through a hundred
 * thumbnails without cleanup would hold every one of them forever.
 */
export function useBlobUrl(store: MediaBlobStore, key: string | null): string | null {
  // The resolved key is stored *alongside* its URL so the result can be matched
  // against the current key during render. Clearing it with a `setUrl(null)` in
  // the effect instead would mean an extra render pass on every key change —
  // and would briefly show the previous asset's thumbnail under the new one.
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key) return;

    let objectUrl: string | null = null;
    // Guards against a slow lookup resolving after the key changed.
    let cancelled = false;

    void store.get(key).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setResolved({ key, url: objectUrl });
    });

    return () => {
      cancelled = true;
      // Object URLs pin their blob in memory until revoked, so a library
      // scrolled past a hundred thumbnails would otherwise hold every one.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [store, key]);

  return resolved && resolved.key === key ? resolved.url : null;
}
