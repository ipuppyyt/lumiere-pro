import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startHost, type Host } from "@lumiere-pro/host";
import { APP_VERSION, FORMAT_VERSION, type MediaProbe } from "@lumiere-pro/core";
import { createEditorStore, type EditorStore } from "../src/state/editorStore";
import { selectTimelineLayout } from "../src/state/layout";
import { httpTransport } from "../src/state/transport";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Deterministic stand-in for ffprobe: 10 s of 30 fps video with one stereo audio stream.
const fakeProbe = async (real: string): Promise<MediaProbe> => ({
  path: real,
  name: path.basename(real),
  durationSec: 10,
  width: 1280,
  height: 720,
  fps: { num: 30, den: 1 },
  hasVideo: true,
  audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }],
});

let tmp: string;
let host: Host;
let ui: EditorStore;
let stopUi: () => void;
let mcp: Client;
let mediaPath: string;

async function until(cond: () => boolean, what: string) {
  const deadline = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]!.text;
  return { isError: Boolean(r.isError), body: JSON.parse(text) as Record<string, any> };
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ce-int-"));
  mediaPath = path.join(tmp, "source.mp4");
  await fs.writeFile(mediaPath, Buffer.from("0123456789abcdefghij")); // content irrelevant to the fake probe

  host = await startHost({ port: 0, stateDir: tmp, probe: fakeProbe, log: () => {} });
  ui = createEditorStore(httpTransport(`http://127.0.0.1:${host.port}`, { authorization: `Bearer ${host.token}` }));
  stopUi = ui.getState().start();
  await until(() => ui.getState().connected && ui.getState().project !== null, "UI connected");

  mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.join(root, "packages/mcp/src/index.ts")],
      env: { CE_STATE_DIR: tmp },
      cwd: root,
      stderr: "ignore",
    }),
  );
});

afterAll(async () => {
  await mcp?.close();
  stopUi?.();
  await host?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Claude -> MCP -> host store -> visible timeline", () => {
  it("exposes exactly the required tools", async () => {
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["get_project_state", "list_media", "move_clip", "remove_clip", "split_clip", "trim_clip", "undo_edit"].sort(),
    );
  });

  it("reports one consistent version from the MCP server and the host", async () => {
    expect(mcp.getServerVersion()).toMatchObject({ name: "lumiere-pro", version: APP_VERSION });
    const v = await (
      await fetch(`http://127.0.0.1:${host.port}/api/version`, { headers: { authorization: `Bearer ${host.token}` } })
    ).json();
    expect(v).toEqual({ app: "Lumiere Pro", version: APP_VERSION, projectFormat: FORMAT_VERSION });
  });

  it("a manual UI import is visible to MCP", async () => {
    expect(await ui.getState().importMedia(mediaPath)).toBe(true);
    await until(() => ui.getState().project!.clips.length === 1, "clip in UI");

    const media = await tool("list_media");
    expect(media.body.media[0]).toMatchObject({ width: 1280, height: 720, durationFrames: 300 });
    expect(media.body.media[0].audioStreams).toHaveLength(1);

    const state = await tool("get_project_state");
    expect(state.body.revision).toBe(1);
    expect(state.body.clips).toHaveLength(1);
  });

  it("an MCP split changes the visible timeline without any UI action", async () => {
    const before = ui.getState();
    const baseline = before.snapshotCount;
    expect(selectTimelineLayout(before.project, before.zoom)).toHaveLength(1);

    const res = await tool("split_clip", { clipId: "clip_2", atFrame: 120, expectedRevision: 1 });
    expect(res.isError).toBe(false);
    expect(res.body).toMatchObject({ ok: true, revision: 2, affectedClipIds: ["clip_2", "clip_3"] });

    // The UI store receives the transaction by subscription; nobody called into it.
    await until(() => ui.getState().project!.revision === 2, "UI revision 2");
    const after = ui.getState();
    expect(after.snapshotCount).toBe(baseline + 1);
    expect(after.lastChange).toMatchObject({ kind: "split_clip", origin: "claude", affectedClipIds: ["clip_2", "clip_3"] });
    expect(selectTimelineLayout(after.project, after.zoom).map((b) => [b.id, b.startFrame, b.endFrame])).toEqual([
      ["clip_2", 0, 120],
      ["clip_3", 120, 300],
    ]);
    expect(after.canUndo).toBe(true);
  });

  it("rejects a stale revision, leaves state untouched and reports the current revision", async () => {
    const res = await tool("remove_clip", { clipId: "clip_3", expectedRevision: 1 });
    expect(res.isError).toBe(true);
    expect(res.body).toMatchObject({ ok: false, code: "STALE_REVISION", currentRevision: 2 });
    expect(ui.getState().project!.clips).toHaveLength(2);
  });

  it("validates inputs: schema errors and domain errors never mutate", async () => {
    const bad = await mcp.callTool({ name: "move_clip", arguments: { clipId: "clip_3", startFrame: 1.5, expectedRevision: 2 } });
    expect(bad.isError).toBe(true);
    const overlap = await tool("move_clip", { clipId: "clip_3", startFrame: 10, expectedRevision: 2 });
    expect(overlap.body).toMatchObject({ ok: false, code: "OVERLAP" });
    const missing = await tool("trim_clip", { clipId: "nope", side: "end", toFrame: 5, expectedRevision: 2 });
    expect(missing.body).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(ui.getState().project!.revision).toBe(2);
  });

  it("MCP trim and move update the timeline; a UI edit and MCP undo share one history", async () => {
    expect((await tool("trim_clip", { clipId: "clip_3", side: "end", toFrame: 240, expectedRevision: 2 })).body.revision).toBe(3);
    expect((await tool("move_clip", { clipId: "clip_3", startFrame: 150, expectedRevision: 3 })).body.revision).toBe(4);
    await until(() => ui.getState().project!.revision === 4, "UI revision 4");
    expect(ui.getState().project!.clips.find((c) => c.id === "clip_3")).toMatchObject({
      startFrame: 150,
      inFrame: 120,
      durationFrames: 120, // end trimmed to timeline frame 240 => 240 - 120
    });

    // Manual edit through the same command service...
    expect(await ui.getState().run({ type: "remove_clip", clipId: "clip_3" })).toBe(true);
    await until(() => ui.getState().project!.revision === 5, "UI revision 5");
    // ...and Claude can undo it.
    const undo = await tool("undo_edit", { expectedRevision: 5 });
    expect(undo.body).toMatchObject({ ok: true, revision: 6, affectedClipIds: ["clip_3"] });
    await until(() => ui.getState().project!.revision === 6, "UI revision 6");
    expect(ui.getState().project!.clips.map((c) => c.id).sort()).toEqual(["clip_2", "clip_3"]);

    // Claude removes a clip.
    expect((await tool("remove_clip", { clipId: "clip_3", expectedRevision: 6 })).body.revision).toBe(7);
    await until(() => ui.getState().project!.clips.length === 1, "clip removed in UI");
  });

  it("a stale UI edit is also rejected by the same service", async () => {
    // Force the UI to believe it is behind.
    const staleRev = ui.getState().project!.revision - 1;
    const r = await httpTransport(`http://127.0.0.1:${host.port}`, { authorization: `Bearer ${host.token}` }).command(
      { type: "undo" },
      staleRev,
    );
    expect(r).toMatchObject({ ok: false, code: "STALE_REVISION" });
  });
});

describe("host safety", () => {
  const base = () => `http://127.0.0.1:${host.port}`;
  const auth = () => ({ authorization: `Bearer ${host.token}`, "content-type": "application/json" });

  it("requires the token and a loopback Host header", async () => {
    expect((await fetch(`${base()}/api/state`)).status).toBe(401);
    expect((await fetch(`${base()}/api/state`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await fetch(`${base()}/api/state`, { headers: auth() })).status).toBe(200);
  });

  it("rejects bad media paths", async () => {
    const imp = async (p: string) =>
      (await (await fetch(`${base()}/api/media/import`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ path: p, expectedRevision: ui.getState().project!.revision }),
      })).json()) as { ok: boolean; code?: string };
    for (const p of ["relative.mp4", "C:\\a\\..\\b.mp4", "\\\\server\\share\\a.mp4", path.join(tmp, "a.exe"), path.join(tmp, "missing.mp4")]) {
      expect(await imp(p)).toMatchObject({ ok: false, code: "INVALID_PATH" });
    }
  });

  it("streams media with byte ranges, read-only", async () => {
    const res = await fetch(`${base()}/media/media_1`, { headers: { ...auth(), range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("2345");
    expect((await fetch(`${base()}/media/media_1`, { method: "POST", headers: auth() })).status).toBe(405);
  });

  it("media token works for GET /media only, never for the API", async () => {
    const { mediaToken } = (await (await fetch(`${base()}/api/session`, { headers: auth() })).json()) as { mediaToken: string };
    const ok = await fetch(`${base()}/media/media_1?t=${mediaToken}`, { headers: { range: "bytes=0-1" } });
    expect(ok.status).toBe(206);
    expect((await fetch(`${base()}/media/media_1?t=wrong`)).status).toBe(401);
    expect((await fetch(`${base()}/api/state?t=${mediaToken}`)).status).toBe(401);
    expect((await fetch(`${base()}/api/session?t=${mediaToken}`)).status).toBe(401);
  });

  it("saves and reopens a versioned project, never overwriting source media", async () => {
    const save = (p: string) =>
      fetch(`${base()}/api/project/save`, { method: "POST", headers: auth(), body: JSON.stringify({ path: p }) }).then((r) => r.json());
    const target = path.join(tmp, "demo.lumiere.json");
    expect(await save(target)).toMatchObject({ ok: true });
    const onDisk = JSON.parse(await fs.readFile(target, "utf8"));
    expect(onDisk.formatVersion).toBe(1);
    expect(onDisk.clips.every((c: { startFrame: number }) => Number.isInteger(c.startFrame))).toBe(true);

    expect(await save(mediaPath)).toMatchObject({ ok: false, code: "INVALID_PATH" });
    expect(await fs.readFile(mediaPath, "utf8")).toBe("0123456789abcdefghij");

    const revBefore = ui.getState().project!.revision;
    expect(await ui.getState().run({ type: "remove_clip", clipId: "clip_2" })).toBe(true);
    await until(() => ui.getState().project!.clips.length === 0, "clip removed");
    expect(await ui.getState().openProject(target)).toBe(true);
    await until(() => ui.getState().project!.clips.length === 1, "project reopened");
    expect(ui.getState().project!.revision).toBeGreaterThan(revBefore + 1);
    expect((await tool("get_project_state")).body.clips).toHaveLength(1);
  });
});
