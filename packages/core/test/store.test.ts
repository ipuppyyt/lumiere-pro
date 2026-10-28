import { describe, expect, it } from "vitest";
import { parseProject, ProjectStore, serializeProject, type MediaProbe, type Project } from "../src";

const probe: MediaProbe = {
  path: "C:\\media\\a.mp4",
  name: "a.mp4",
  durationSec: 10,
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  hasVideo: true,
  audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }],
};

function seeded() {
  const s = new ProjectStore(undefined, () => "p1");
  const r = s.execute({ type: "import_media", probe }, 0);
  if (!r.ok) throw new Error(r.message);
  return s;
}
const ok = (r: ReturnType<ProjectStore["execute"]>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

describe("import", () => {
  it("stores integer frames and bumps revision", () => {
    const s = seeded();
    expect(s.state.revision).toBe(1);
    expect(s.state.media[0]!.durationFrames).toBe(300);
    expect(s.state.clips).toEqual([
      { id: "clip_2", mediaId: "media_1", startFrame: 0, inFrame: 0, durationFrames: 300 },
    ]);
  });
});

describe("split", () => {
  it("splits into two contiguous clips with correct source offsets", () => {
    const s = seeded();
    const r = ok(s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1));
    expect(r.revision).toBe(2);
    expect(r.affectedClipIds).toEqual(["clip_2", "clip_3"]);
    expect(s.state.clips).toEqual([
      { id: "clip_2", mediaId: "media_1", startFrame: 0, inFrame: 0, durationFrames: 100 },
      { id: "clip_3", mediaId: "media_1", startFrame: 100, inFrame: 100, durationFrames: 200 },
    ]);
  });
  it.each([0, 300, 999])("rejects split at %i", (f) => {
    const s = seeded();
    const r = s.execute({ type: "split_clip", clipId: "clip_2", atFrame: f }, 1);
    expect(r.ok).toBe(false);
    expect(s.state.revision).toBe(1);
  });
  it("rejects non-integer frames", () => {
    const r = seeded().execute({ type: "split_clip", clipId: "clip_2", atFrame: 10.5 }, 1);
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});

describe("trim", () => {
  it("trims start, adjusting source in-point", () => {
    const s = seeded();
    ok(s.execute({ type: "trim_clip", clipId: "clip_2", side: "start", toFrame: 50 }, 1));
    expect(s.state.clips[0]).toMatchObject({ startFrame: 50, inFrame: 50, durationFrames: 250 });
  });
  it("trims end", () => {
    const s = seeded();
    ok(s.execute({ type: "trim_clip", clipId: "clip_2", side: "end", toFrame: 120 }, 1));
    expect(s.state.clips[0]).toMatchObject({ startFrame: 0, inFrame: 0, durationFrames: 120 });
  });
  it("can re-extend an end trim within source bounds but not beyond", () => {
    const s = seeded();
    ok(s.execute({ type: "trim_clip", clipId: "clip_2", side: "end", toFrame: 120 }, 1));
    ok(s.execute({ type: "trim_clip", clipId: "clip_2", side: "end", toFrame: 300 }, 2));
    const r = s.execute({ type: "trim_clip", clipId: "clip_2", side: "end", toFrame: 301 }, 3);
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
  it("rejects trim start past end", () => {
    const r = seeded().execute({ type: "trim_clip", clipId: "clip_2", side: "start", toFrame: 300 }, 1);
    expect(r.ok).toBe(false);
  });
});

describe("move", () => {
  it("moves a clip and rejects overlaps", () => {
    const s = seeded();
    ok(s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1));
    ok(s.execute({ type: "move_clip", clipId: "clip_3", startFrame: 500 }, 2));
    expect(s.state.clips.find((c) => c.id === "clip_3")!.startFrame).toBe(500);
    const bad = s.execute({ type: "move_clip", clipId: "clip_3", startFrame: 50 }, 3);
    expect(bad).toMatchObject({ ok: false, code: "OVERLAP" });
    expect(s.state.revision).toBe(3);
  });
});

describe("remove", () => {
  it("removes a clip", () => {
    const s = seeded();
    ok(s.execute({ type: "remove_clip", clipId: "clip_2" }, 1));
    expect(s.state.clips).toEqual([]);
  });
  it("reports NOT_FOUND", () => {
    expect(seeded().execute({ type: "remove_clip", clipId: "nope" }, 1)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("undo/redo", () => {
  it("round-trips and keeps revision monotonic", () => {
    const s = seeded();
    const before = s.state.clips;
    ok(s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1));
    const u = ok(s.execute({ type: "undo" }, 2));
    expect(s.state.clips).toEqual(before);
    expect(u.revision).toBe(3);
    expect(u.affectedClipIds.sort()).toEqual(["clip_2", "clip_3"]);
    ok(s.execute({ type: "redo" }, 3));
    expect(s.state.clips).toHaveLength(2);
    expect(s.state.revision).toBe(4);
  });
  it("a new edit clears redo", () => {
    const s = seeded();
    ok(s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1));
    ok(s.execute({ type: "undo" }, 2));
    ok(s.execute({ type: "remove_clip", clipId: "clip_2" }, 3));
    expect(s.execute({ type: "redo" }, 4)).toMatchObject({ ok: false, code: "NOTHING_TO_REDO" });
  });
  it("rejects undo with empty history", () => {
    const s = new ProjectStore();
    expect(s.execute({ type: "undo" }, 0)).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  });
});

describe("revisions", () => {
  it("rejects stale revisions without mutating", () => {
    const s = seeded();
    const r = s.execute({ type: "remove_clip", clipId: "clip_2" }, 0);
    expect(r).toMatchObject({ ok: false, code: "STALE_REVISION", currentRevision: 1 });
    expect(s.state.clips).toHaveLength(1);
  });
  it("rejects missing revision and malformed commands", () => {
    const s = seeded();
    expect(s.execute({ type: "remove_clip", clipId: "clip_2" }, undefined)).toMatchObject({ ok: false });
    expect(s.execute({ type: "explode" }, 1)).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
  it("notifies subscribers once per transaction, not for failures", () => {
    const s = seeded();
    const seen: number[] = [];
    s.subscribe((_p, c) => seen.push(c.revision));
    s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1);
    s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1); // stale
    expect(seen).toEqual([2]);
  });
});

describe("persistence", () => {
  it("round-trips a project file", () => {
    const s = seeded();
    ok(s.execute({ type: "split_clip", clipId: "clip_2", atFrame: 100 }, 1));
    expect(parseProject(serializeProject(s.state))).toEqual(s.state);
  });
  it("rejects newer versions and garbage", () => {
    const p = JSON.parse(serializeProject(seeded().state)) as Omit<Project, "formatVersion"> & { formatVersion: number };
    p.formatVersion = 99;
    expect(() => parseProject(JSON.stringify(p))).toThrow(/newer/);
    expect(() => parseProject("{")).toThrow(/JSON/);
    expect(() => parseProject(JSON.stringify({ formatVersion: 1 }))).toThrow(/invalid/);
  });
  it("open keeps revision monotonic and clears history", () => {
    const s = seeded();
    const saved = s.state;
    ok(s.execute({ type: "remove_clip", clipId: "clip_2" }, 1));
    s.replace(saved);
    expect(s.state.revision).toBe(3);
    expect(s.execute({ type: "undo" }, 3)).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  });
});
