/**
 * Schema migrations.
 *
 * A project saved today must still open in two years. That promise is only
 * keepable if every breaking change to the document ships with a migration at
 * the same time — so the chain lives here, next to the loader, rather than
 * being remembered by whoever changed the schema.
 *
 * Rules:
 * - A migration takes the document *at version N* and returns it at N+1.
 * - Migrations are pure and must never throw. A document that cannot be
 *   migrated is still returned, and validation downstream decides what to keep.
 * - Never edit an existing migration once released; add a new one.
 */

import { SCHEMA_VERSION } from "@cutaway/types";

export type RawDocument = Record<string, unknown>;

export interface Migration {
  /** Version this migration upgrades *from*. */
  from: number;
  describe: string;
  apply: (document: RawDocument) => RawDocument;
}

/**
 * Ordered migration chain.
 *
 * Empty because version 1 is the first released schema. The machinery exists
 * now, before it is needed — retrofitting migrations after users have saved
 * projects means the earliest documents are already unreadable.
 */
export const MIGRATIONS: Migration[] = [];

export interface MigrationResult {
  document: RawDocument;
  /** Human-readable log of what ran, surfaced when a project is opened. */
  applied: string[];
  /** True when the document is newer than this build understands. */
  fromFuture: boolean;
}

export function migrateDocument(input: RawDocument): MigrationResult {
  const applied: string[] = [];
  let document = input;

  const rawVersion = document.schemaVersion;
  let version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 0;

  // A document from a newer build may contain fields this one will drop on
  // save. Flagged so the UI can warn before silently downgrading the user's work.
  if (version > SCHEMA_VERSION) {
    return { document, applied, fromFuture: true };
  }

  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((candidate) => candidate.from === version);
    if (!migration) {
      // No path forward. Stamp the current version and let validation repair
      // what it can rather than refusing to open the project at all.
      document = { ...document, schemaVersion: SCHEMA_VERSION };
      break;
    }

    document = migration.apply(document);
    applied.push(migration.describe);
    version += 1;
    document = { ...document, schemaVersion: version };
  }

  return { document, applied, fromFuture: false };
}
