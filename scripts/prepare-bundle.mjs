// Stages everything the packaged app needs under apps/desktop/src-tauri/resources:
//   node/node.exe   the Node runtime that runs the host (copied from the Node running this script)
//   host/host.mjs   single-file bundle of packages/host
//   mcp/index.js    single-file bundle of the stdio MCP server (what Claude Code launches)
//   ui/             the built React app (apps/desktop/dist), served by the host
//   ffmpeg/         EMPTY unless CE_BUNDLE_FFPROBE points at an ffprobe.exe you are licensed to ship
// Run from apps/desktop (Tauri's beforeBuildCommand does this) after `vite build`.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(repo, "apps/desktop");
const out = path.join(desktop, "src-tauri/resources");

rmSync(out, { recursive: true, force: true });
for (const d of ["node", "host", "mcp", "ui", "ffmpeg"]) mkdirSync(path.join(out, d), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "warning",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};
await build({ ...common, entryPoints: [path.join(repo, "packages/host/src/main.ts")], outfile: path.join(out, "host/host.mjs") });
await build({ ...common, entryPoints: [path.join(repo, "packages/mcp/src/index.ts")], outfile: path.join(out, "mcp/index.js") });
// The bundles are ESM; make sure Node treats the .js file that way.
writeFileSync(path.join(out, "mcp/package.json"), JSON.stringify({ type: "module" }));

const dist = path.join(desktop, "dist");
if (!existsSync(path.join(dist, "index.html"))) throw new Error("apps/desktop/dist is missing; run `npm run build` first");
cpSync(dist, path.join(out, "ui"), { recursive: true });

cpSync(process.execPath, path.join(out, "node/node.exe"));
console.log(`bundled Node ${process.version} from ${process.execPath}`);

const ffprobe = process.env.CE_BUNDLE_FFPROBE;
if (ffprobe) {
  if (!existsSync(ffprobe)) throw new Error(`CE_BUNDLE_FFPROBE not found: ${ffprobe}`);
  cpSync(ffprobe, path.join(out, "ffmpeg/ffprobe.exe"));
  console.log(`bundled ffprobe from ${ffprobe}`);
} else {
  writeFileSync(path.join(out, "ffmpeg/README.txt"), "ffprobe is not bundled; install FFmpeg or set CE_FFPROBE.\n");
  console.log("ffprobe NOT bundled (set CE_BUNDLE_FFPROBE to include it)");
}
