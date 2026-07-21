/**
 * Media blob persistence.
 *
 * Defined as an interface first, with IndexedDB as one implementation. The
 * indirection is not speculative: tests need an in-memory store, and the
 * planned desktop build will back this with the real filesystem. Nothing above
 * this layer should know which one it is talking to.
 */

/** Key-value store for media bytes. Keys are opaque strings. */
export interface MediaBlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

const DATABASE_NAME = "opencut";
const DATABASE_VERSION = 1;
const BLOB_STORE = "media-blobs";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-backed store.
 *
 * IndexedDB rather than the Cache API or localStorage: it is the only web
 * storage that holds large binary blobs, survives reloads, and has a quota
 * measured in gigabytes. A 4K video does not fit anywhere else.
 */
export class IndexedDBMediaStore implements MediaBlobStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    // Cached so concurrent imports share one connection instead of racing to
    // open several and triggering version-change conflicts.
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BLOB_STORE)) {
          database.createObjectStore(BLOB_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.databasePromise;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(BLOB_STORE, mode);
      const request = run(tx.objectStore(BLOB_STORE));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async put(key: string, blob: Blob): Promise<void> {
    await this.transaction("readwrite", (store) => store.put(blob, key));
  }

  async get(key: string): Promise<Blob | null> {
    const result = await this.transaction<Blob | undefined>("readonly", (store) => store.get(key));
    return result ?? null;
  }

  async delete(key: string): Promise<void> {
    await this.transaction("readwrite", (store) => store.delete(key));
  }

  async keys(): Promise<string[]> {
    const result = await this.transaction<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    return result.map(String);
  }

  async clear(): Promise<void> {
    await this.transaction("readwrite", (store) => store.clear());
  }
}

/** In-memory store, for tests and for SSR where IndexedDB does not exist. */
export class MemoryMediaStore implements MediaBlobStore {
  private readonly entries = new Map<string, Blob>();

  async put(key: string, blob: Blob): Promise<void> {
    this.entries.set(key, blob);
  }

  async get(key: string): Promise<Blob | null> {
    return this.entries.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Returns the appropriate store for the current environment. */
export function createMediaStore(): MediaBlobStore {
  return typeof indexedDB === "undefined" ? new MemoryMediaStore() : new IndexedDBMediaStore();
}
