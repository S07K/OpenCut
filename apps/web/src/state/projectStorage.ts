"use client";

import type { Id, ProjectDocument } from "@opencut/types";

/**
 * Project persistence in IndexedDB.
 *
 * Projects live in a **separate database** from media blobs, so a document is
 * small and cheap to write on every autosave while the gigabytes of footage
 * stay untouched.
 *
 * Separate databases rather than a second object store in `opencut`: two places
 * opening the same database at different versions throws `VersionError`, and
 * the media store (owned by `@opencut/media-engine`) has no business knowing
 * the project schema. Independent databases let each layer version itself.
 */

const DATABASE_NAME = "opencut-projects";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";

export interface StoredProject {
  id: Id;
  name: string;
  savedAt: number;
  document: ProjectDocument;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(PROJECT_STORE, mode);
        const request = run(tx.objectStore(PROJECT_STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function saveProject(project: ProjectDocument): Promise<void> {
  const record: StoredProject = {
    id: project.id,
    name: project.name,
    savedAt: Date.now(),
    // Cloned so a later in-memory mutation cannot alter what IndexedDB is
    // mid-way through writing.
    document: structuredClone(project),
  };

  await runTransaction("readwrite", (store) => store.put(record));
}

export async function loadProject(id: Id): Promise<StoredProject | null> {
  const result = await runTransaction<StoredProject | undefined>("readonly", (store) =>
    store.get(id),
  );
  return result ?? null;
}

export async function listProjects(): Promise<StoredProject[]> {
  const all = await runTransaction<StoredProject[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProject(id: Id): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
}

/** The most recently saved project, used to restore the session on startup. */
export async function loadMostRecentProject(): Promise<StoredProject | null> {
  const projects = await listProjects();
  return projects[0] ?? null;
}

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
