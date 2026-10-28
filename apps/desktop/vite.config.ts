import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostPort = Number(process.env.CE_PORT ?? 47821);
const stateDir = process.env.CE_STATE_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "lumiere-pro");

/** The host's bearer token lives in host.json; the dev proxy injects it so the browser never sees it. */
function authHeader(): string {
  try {
    return `Bearer ${(JSON.parse(readFileSync(path.join(stateDir, "host.json"), "utf8")) as { token: string }).token}`;
  } catch {
    return "Bearer unavailable";
  }
}

const proxy = {
  target: `http://127.0.0.1:${hostPort}`,
  changeOrigin: true,
  configure(p: { on: (ev: string, fn: (req: { setHeader(k: string, v: string): void; removeHeader(k: string): void }) => void) => void }) {
    p.on("proxyReq", (req) => {
      req.setHeader("authorization", authHeader());
      req.removeHeader("origin");
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { "/api": proxy, "/media": proxy } },
});
