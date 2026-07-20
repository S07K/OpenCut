/**
 * Blob garbage collection.
 *
 * Media bytes outlive the documents that referenced them: a project is deleted,
 * an import is abandoned, a tab crashes mid-import. Without a sweep the store
 * grows forever and eventually exhausts the origin's storage quota — at which
 * point *new* imports start failing for reasons the user cannot diagnose.
 */

import type { MediaBlobStore } from "./storage";

export interface GarbageCollectionResult {
  deletedKeys: string[];
  keptCount: number;
  bytesFreed: number;
}

/**
 * Deletes every blob not referenced by a live project.
 *
 * `referencedKeys` must be the union across **all** stored projects, not just
 * the open one. Passing a single project's keys would delete the media of every
 * other project the user has.
 */
export async function collectGarbage(
  store: MediaBlobStore,
  referencedKeys: ReadonlySet<string>,
): Promise<GarbageCollectionResult> {
  const allKeys = await store.keys();
  const orphans = allKeys.filter((key) => !referencedKeys.has(key));

  let bytesFreed = 0;

  for (const key of orphans) {
    // Sized before deletion so the UI can report what was reclaimed. A missing
    // blob simply contributes zero rather than aborting the sweep.
    const blob = await store.get(key);
    if (blob) bytesFreed += blob.size;
    await store.delete(key);
  }

  return {
    deletedKeys: orphans,
    keptCount: allKeys.length - orphans.length,
    bytesFreed,
  };
}
