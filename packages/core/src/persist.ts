import { EditError } from "./errors";
import { FORMAT_VERSION, ProjectSchema, type Project } from "./model";
import { APP_VERSION } from "./version";

/**
 * Upgrades a raw project object from format N to N+1. Register one per format bump, keyed by
 * the version it upgrades FROM. Migrations must be pure and must set `formatVersion` themselves.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** No migrations yet: format 1 is the first. When FORMAT_VERSION becomes 2, add `1: (raw) => ({ ...raw, ..., formatVersion: 2 })`. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function migrateProject(
  raw: Record<string, unknown>,
  from: number,
  to: number = FORMAT_VERSION,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): Record<string, unknown> {
  let cur = raw;
  for (let v = from; v < to; v++) {
    const step = migrations[v];
    if (!step) throw new EditError("UNSUPPORTED_VERSION", `No migration from project format ${v} to ${v + 1}`);
    cur = step(cur);
    if (cur.formatVersion !== v + 1) {
      throw new EditError("UNSUPPORTED_VERSION", `Migration ${v} -> ${v + 1} did not set formatVersion ${v + 1}`);
    }
  }
  return cur;
}

/** `savedWith` is informational (which app wrote the file); it is not part of the in-memory project. */
export function serializeProject(p: Project): string {
  const { formatVersion, ...rest } = ProjectSchema.parse(p);
  return JSON.stringify({ formatVersion, savedWith: APP_VERSION, ...rest }, null, 2) + "\n";
}

/** Parses a project file, migrating older formatVersions forward. Rejects newer/unknown ones. */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EditError("IO_ERROR", "Project file is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EditError("IO_ERROR", "Project file must contain a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new EditError("UNSUPPORTED_VERSION", "Project file has no valid integer formatVersion");
  }
  if (version > FORMAT_VERSION) {
    const by = typeof obj.savedWith === "string" ? ` (saved by Lumiere Pro ${obj.savedWith})` : "";
    throw new EditError(
      "UNSUPPORTED_VERSION",
      `Project file format ${version}${by} is newer than this version of Lumiere Pro supports (format ${FORMAT_VERSION}). Update the app to open it.`,
    );
  }
  const parsed = ProjectSchema.safeParse(migrateProject(obj, version));
  if (!parsed.success) {
    throw new EditError("IO_ERROR", `Project file is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}
