import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual, randomBytes } from "node:crypto";
import {
  APP_VERSION,
  EditError,
  FORMAT_VERSION,
  parseProject,
  ProjectStore,
  serializeProject,
  type HostInfo,
  type Origin,
  type Snapshot,
} from "@lumiere-pro/core";
import { validateMediaPath, validateProjectPath, writeFileAtomic } from "./paths";
import { ffprobeProbe, type ProbeFn } from "./probe";

export interface HostOptions {
  /** 0 picks a free port. */
  port?: number;
  stateDir?: string;
  probe?: ProbeFn;
  /** Built UI directory to serve at "/". Optional (dev uses the Vite server). */
  uiDir?: string;
  log?: (msg: string) => void;
}

export interface Host {
  port: number;
  token: string;
  store: ProjectStore;
  infoPath: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function defaultStateDir(): string {
  return process.env.CE_STATE_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "lumiere-pro");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startHost(opts: HostOptions = {}): Promise<Host> {
  const log = opts.log ?? ((m: string) => console.error(`[host] ${m}`));
  const probe = opts.probe ?? ffprobeProbe();
  const stateDir = opts.stateDir ?? defaultStateDir();
  const token = randomBytes(32).toString("hex");
  /** Read-only credential for <video src>, which cannot send headers. Only valid on GET /media/*. */
  const mediaToken = randomBytes(16).toString("hex");
  const store = new ProjectStore();
  const clients = new Set<http.ServerResponse>();
  let currentProjectPath: string | null = null;

  const snapshot = (change: Snapshot["change"]): Snapshot => ({
    project: store.state,
    change,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
  });
  store.subscribe((_p, change) => {
    const frame = `data: ${JSON.stringify(snapshot(change))}\n\n`;
    for (const res of clients) res.write(frame);
  });

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(text);
  };

  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 1_000_000) {
          reject(new HttpError(413, "Body too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const v: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
          resolve(v as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, "Body must be a JSON object"));
        }
      });
      req.on("error", reject);
    });

  const asOrigin = (v: unknown): Origin => (v === "claude" ? "claude" : "ui");

  const same = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const authorized = (req: http.IncomingMessage, query: URLSearchParams, isMedia: boolean): boolean => {
    const h = req.headers.authorization ?? "";
    if (same(h.startsWith("Bearer ") ? h.slice(7) : "", token)) return true;
    return isMedia && same(query.get("t") ?? "", mediaToken);
  };

  async function serveMedia(req: http.IncomingMessage, res: http.ServerResponse, mediaId: string) {
    const asset = store.state.media.find((m) => m.id === mediaId);
    if (!asset) throw new HttpError(404, "Unknown media");
    const real = await validateMediaPath(asset.path).catch(() => {
      throw new HttpError(404, "Media file is missing on disk");
    });
    const { size } = await fs.stat(real);
    const type = MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(range[2]));
      }
      if (start > end || start >= size) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        return res.end();
      }
      status = 206;
    }
    const headers: http.OutgoingHttpHeaders = {
      "content-type": type,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    // Read-only stream; the source file is never opened for writing.
    createReadStream(real, { start, end, flags: "r" }).pipe(res);
  }

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    if (req.method === "GET" && pathname === "/api/state") return json(res, 200, snapshot(null));
    if (req.method === "GET" && pathname === "/api/version") {
      return json(res, 200, { app: "Lumiere Pro", version: APP_VERSION, projectFormat: FORMAT_VERSION });
    }
    if (req.method === "GET" && pathname === "/api/session") return json(res, 200, { mediaToken });

    if (req.method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(snapshot(null))}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const body = await readBody(req);

    if (pathname === "/api/command") {
      return json(res, 200, store.execute(body.command, body.expectedRevision, asOrigin(body.origin)));
    }

    if (pathname === "/api/media/import") {
      const real = await validateMediaPath(body.path);
      const probed = await probe(real);
      const addToTimeline = body.addToTimeline !== false;
      return json(
        res,
        200,
        store.execute({ type: "import_media", probe: probed, addToTimeline }, body.expectedRevision, asOrigin(body.origin)),
      );
    }

    if (pathname === "/api/project/save") {
      const target = await validateProjectPath(
        body.path ?? currentProjectPath,
        "save",
        store.state.media.map((m) => m.path),
      );
      await writeFileAtomic(target, serializeProject(store.state));
      currentProjectPath = target;
      return json(res, 200, { ok: true, path: target, revision: store.state.revision });
    }

    if (pathname === "/api/project/open") {
      const target = await validateProjectPath(body.path, "open", []);
      const text = await fs.readFile(target, "utf8").catch((e: Error) => {
        throw new EditError("IO_ERROR", `Could not read project: ${e.message}`);
      });
      const project = parseProject(text);
      const missing: string[] = [];
      for (const m of project.media) {
        await validateMediaPath(m.path).catch(() => missing.push(m.path));
      }
      store.replace(project);
      currentProjectPath = target;
      return json(res, 200, { ok: true, path: target, revision: store.state.revision, missingMedia: missing });
    }

    throw new HttpError(404, "Not found");
  }

  async function serveStatic(res: http.ServerResponse, pathname: string) {
    if (!opts.uiDir) throw new HttpError(404, "Not found");
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(opts.uiDir, rel);
    if (!file.startsWith(path.resolve(opts.uiDir) + path.sep)) throw new HttpError(404, "Not found");
    const data = await fs.readFile(file).catch(() => {
      throw new HttpError(404, "Not found");
    });
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        // Defeat DNS rebinding: only accept loopback Host headers.
        const host = (req.headers.host ?? "").replace(/:\d+$/, "");
        if (host !== "127.0.0.1" && host !== "localhost") throw new HttpError(403, "Bad Host header");
        const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");
        if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
          if (!authorized(req, searchParams, pathname.startsWith("/media/"))) throw new HttpError(401, "Unauthorized");
          if (pathname.startsWith("/media/")) {
            if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
            return await serveMedia(req, res, decodeURIComponent(pathname.slice(7)));
          }
          return await handleApi(req, res, pathname);
        }
        await serveStatic(res, pathname);
      } catch (e) {
        if (res.headersSent) return void res.end();
        if (e instanceof HttpError) return json(res, e.status, { ok: false, code: "HTTP_ERROR", message: e.message });
        if (e instanceof EditError) {
          return json(res, 200, { ok: false, code: e.code, message: e.message, currentRevision: store.state.revision });
        }
        log(`unhandled: ${(e as Error).stack ?? e}`);
        json(res, 500, { ok: false, code: "INTERNAL", message: "Internal error" });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;

  await fs.mkdir(stateDir, { recursive: true });
  const infoPath = path.join(stateDir, "host.json");
  const info: HostInfo = { port, token, pid: process.pid };
  await fs.writeFile(infoPath, JSON.stringify(info), "utf8");
  log(`listening on 127.0.0.1:${port}; info at ${infoPath}`);

  return {
    port,
    token,
    store,
    infoPath,
    async close() {
      for (const c of clients) c.end();
      clients.clear();
      await new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      });
      await fs.rm(infoPath, { force: true });
    },
  };
}
