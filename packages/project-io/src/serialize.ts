/**
 * Reading and writing `.cutaway` project files.
 *
 * The file *is* the project document plus a small envelope. No proprietary
 * container, no binary blob: a creator can open it in a text editor, diff it in
 * git, and paste it into a bug report. That transparency is a feature of an
 * open-source tool, not an implementation detail.
 */

import type { ProjectDocument } from "@cutaway/types";
import { migrateDocument, type RawDocument } from "./migrate";
import { validateProject, type ValidationIssue } from "./validate";

export const PROJECT_FILE_EXTENSION = "cutaway";
export const PROJECT_FILE_MIME = "application/json";

/** Marks the file as ours, so a wrong file is rejected with a clear message. */
export const PROJECT_FILE_MAGIC = "cutaway.project";

export interface ProjectFile {
  magic: string;
  /** Version of the *envelope*; the document carries its own schemaVersion. */
  fileVersion: number;
  savedAt: number;
  /** Informational only — never used to gate loading. */
  appVersion: string;
  project: ProjectDocument;
}

export const FILE_VERSION = 1;

export interface SerializeOptions {
  appVersion?: string;
  /** Indented output. Default true: diffable files are worth the bytes. */
  pretty?: boolean;
}

export function serializeProject(project: ProjectDocument, options: SerializeOptions = {}): string {
  const file: ProjectFile = {
    magic: PROJECT_FILE_MAGIC,
    fileVersion: FILE_VERSION,
    savedAt: Date.now(),
    appVersion: options.appVersion ?? "0.0.0",
    project,
  };

  return JSON.stringify(file, null, options.pretty === false ? undefined : 2);
}

export type ParseResult =
  | {
      ok: true;
      project: ProjectDocument;
      issues: ValidationIssue[];
      migrations: string[];
      fromFuture: boolean;
    }
  | { ok: false; error: string };

/**
 * Parses a project file.
 *
 * Only two things are hard failures: unparseable JSON, and a file that is not
 * an Cutaway project. Everything else is repaired by `validateProject` and
 * reported through `issues` — losing a corrupt clip beats losing the project.
 */
export function parseProjectFile(contents: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File is not an Cutaway project." };
  }

  const envelope = parsed as Partial<ProjectFile> & RawDocument;

  // Accept a bare document too. Users hand-edit and paste these around, and
  // refusing a valid document for lacking an envelope would be pedantry.
  const rawProject: unknown = envelope.magic === PROJECT_FILE_MAGIC ? envelope.project : parsed;

  if (envelope.magic !== undefined && envelope.magic !== PROJECT_FILE_MAGIC) {
    return { ok: false, error: "File is not an Cutaway project." };
  }

  if (typeof rawProject !== "object" || rawProject === null) {
    return { ok: false, error: "Project data is missing from the file." };
  }

  const migrated = migrateDocument(rawProject as RawDocument);
  const { project, issues } = validateProject(migrated.document);

  return {
    ok: true,
    project,
    issues,
    migrations: migrated.applied,
    fromFuture: migrated.fromFuture,
  };
}

/** Filesystem-safe filename for a project. */
export function projectFileName(projectName: string): string {
  const safe = projectName
    .trim()
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);

  return `${safe || "untitled"}.${PROJECT_FILE_EXTENSION}`;
}

/**
 * Blob storage keys a project depends on.
 *
 * The input to garbage collection: any key in the media store that is not in
 * this set belongs to no project and can be deleted.
 */
export function referencedBlobKeys(project: ProjectDocument): Set<string> {
  const keys = new Set<string>();

  for (const asset of Object.values(project.entities.media)) {
    if (asset.source.type === "indexeddb") keys.add(asset.source.key);
    if (asset.thumbnailKey) keys.add(asset.thumbnailKey);
    if (asset.waveformKey) keys.add(asset.waveformKey);
  }

  return keys;
}
