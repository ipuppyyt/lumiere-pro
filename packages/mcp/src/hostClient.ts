import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EditError, type HostInfo, type Snapshot } from "@lumiere-pro/core";

export function stateDir(): string {
  return process.env.CE_STATE_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "lumiere-pro");
}

const UNAVAILABLE = new EditError(
  "EDITOR_UNAVAILABLE",
  "The Lumiere Pro app is not running. Ask the user to start it (npm run dev) and retry.",
);

async function discover(): Promise<HostInfo> {
  try {
    const info = JSON.parse(await fs.readFile(path.join(stateDir(), "host.json"), "utf8")) as HostInfo;
    if (!Number.isInteger(info.port) || typeof info.token !== "string") throw new Error("bad host.json");
    return info;
  } catch {
    throw UNAVAILABLE;
  }
}

/** Thin client over the editor host. The MCP process never holds project state. */
export class HostClient {
  private async call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const info = await discover();
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${info.port}${url}`, {
        method,
        headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw UNAVAILABLE;
    }
    if (!res.ok) throw new EditError("IO_ERROR", `Editor host returned HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  state(): Promise<Snapshot> {
    return this.call("GET", "/api/state");
  }

  command(command: unknown, expectedRevision: number) {
    return this.call<
      | { ok: true; revision: number; affectedClipIds: string[]; project: Snapshot["project"] }
      | { ok: false; code: string; message: string; currentRevision: number }
    >("POST", "/api/command", { command, expectedRevision, origin: "claude" });
  }
}
