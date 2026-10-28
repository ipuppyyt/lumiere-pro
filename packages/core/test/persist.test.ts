import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  FORMAT_VERSION,
  migrateProject,
  parseProject,
  ProjectStore,
  serializeProject,
  type Migration,
} from "../src";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

describe("golden project files", () => {
  // Frozen copy of a file written by 0.1.0. If this test breaks, you changed the on-disk format:
  // bump FORMAT_VERSION, add a migration, and keep this fixture loading.
  it("format 1 fixture always opens and keeps every value", () => {
    const p = parseProject(fixture("v1-project.lumiere.json"));
    expect(p.formatVersion).toBe(1);
    expect(p).toMatchObject({ id: "fixture-project-1", name: "Golden v1", revision: 7, nextId: 6 });
    expect(p.fps).toEqual({ num: 30000, den: 1001 });
    expect(p.media[0]).toMatchObject({ id: "media_1", durationFrames: 374, width: 1920 });
    expect(p.clips.map((c) => c.id)).toEqual(["clip_2", "clip_5"]);
  });

  it("a fixture-loaded project is editable and keeps ids unique", () => {
    const s = new ProjectStore(parseProject(fixture("v1-project.lumiere.json")));
    const r = s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 60 }, 7);
    expect(r).toMatchObject({ ok: true, affectedClipIds: ["clip_2", "clip_6"] });
  });
});

describe("file envelope", () => {
  it("stamps savedWith and the current formatVersion, and round-trips", () => {
    const loaded = parseProject(fixture("v1-project.lumiere.json"));
    const text = serializeProject(loaded);
    const raw = JSON.parse(text);
    expect(raw.formatVersion).toBe(FORMAT_VERSION);
    expect(raw.savedWith).toBe(APP_VERSION);
    expect(Object.keys(raw)[0]).toBe("formatVersion");
    expect(parseProject(text)).toEqual(loaded);
  });

  it("refuses newer formats with an actionable message naming the writer", () => {
    const raw = JSON.parse(fixture("v1-project.lumiere.json"));
    raw.formatVersion = FORMAT_VERSION + 1;
    raw.savedWith = "9.0.0";
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/saved by Lumiere Pro 9\.0\.0.*Update the app/);
  });

  it.each([0, -1, 1.5, "1", null])("rejects invalid formatVersion %j", (v) => {
    const raw = JSON.parse(fixture("v1-project.lumiere.json"));
    raw.formatVersion = v;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/formatVersion/);
  });

  it.each(["[]", "null", "42"])("rejects non-object JSON %s", (t) => {
    expect(() => parseProject(t)).toThrow(/JSON object/);
  });
});

describe("migrations", () => {
  const up1: Migration = (r) => ({ ...r, formatVersion: 2, addedInV2: true });
  const up2: Migration = (r) => ({ ...r, formatVersion: 3, addedInV3: true });

  it("chains migrations in order from the file's version to the target", () => {
    const out = migrateProject({ formatVersion: 1 }, 1, 3, { 1: up1, 2: up2 });
    expect(out).toEqual({ formatVersion: 3, addedInV2: true, addedInV3: true });
  });
  it("starts from the middle when the file is newer than the oldest format", () => {
    expect(migrateProject({ formatVersion: 2 }, 2, 3, { 1: up1, 2: up2 })).toEqual({ formatVersion: 3, addedInV3: true });
  });
  it("is a no-op when already current", () => {
    const raw = { formatVersion: 3 };
    expect(migrateProject(raw, 3, 3, {})).toBe(raw);
  });
  it("fails loudly on a gap or a migration that forgets formatVersion", () => {
    expect(() => migrateProject({ formatVersion: 1 }, 1, 3, { 1: up1 })).toThrow(/No migration from project format 2/);
    expect(() => migrateProject({ formatVersion: 1 }, 1, 2, { 1: (r) => r })).toThrow(/did not set formatVersion/);
  });
});
