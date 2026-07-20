"use client";

import { useEffect, useState } from "react";
import type { MediaBlobStore } from "@opencut/media-engine";

/**
 * Resolves a stored blob to an object URL for the lifetime of the component.
 *
 * The revoke in the cleanup is the important part. Object URLs pin their blob
 * in memory until revoked, so a media library that scrolls through a hundred
 * thumbnails without cleanup would hold every one of them forever.
 */
export function useBlobUrl(store: MediaBlobStore, key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    // Guards against a slow lookup resolving after the key changed, which would
    // otherwise show the previous asset's thumbnail on the new one.
    let cancelled = false;

    void store.get(key).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [store, key]);

  return url;
}
