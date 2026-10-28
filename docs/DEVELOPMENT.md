# Development guide

## Prerequisites

Windows 10/11 x64. Versions below are what this project was built and tested with.

| Tool | Version | Why | Install |
| --- | --- | --- | --- |
| Node.js | 20+ (tested on 24) | host, MCP server, Vite, tests | https://nodejs.org |
| Rust (MSVC toolchain) | stable (tested 1.99) | Tauri shell | `winget install Rustlang.Rustup` |
| VS 2022 Build Tools, "Desktop development with C++" | 2022 | Rust linker | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` (large; needs admin) |
| WebView2 runtime | any current | Tauri window | preinstalled on Windows 10/11 |
| FFmpeg (needs `ffprobe`) | any recent | inspecting imported media | `winget install Gyan.FFmpeg` |
| Claude Code | recent | to use the MCP server | https://claude.com/claude-code |

**Open a new terminal after installing anything.** `winget` edits PATH, and a running shell keeps its old copy.
A process only sees `ffprobe` if it was launched from a shell that has it on PATH (or you set `CE_FFPROBE`).

Check everything:

```bash
node -v && cargo --version && ffprobe -version
```

## First-time setup

```bash
npm install
npm run build:mcp      # creates packages/mcp/dist/index.js (referenced by .mcp.json)
```

`npm run build:mcp` must be re-run after you change anything in `packages/mcp` or `packages/core`
that the MCP server uses. Tests run the MCP server from source, so they do not need this build.

## Ways to run it

### A. Desktop window (normal development)

```bash
npm run app
```

Starts the Tauri dev build. Behind the scenes:

1. Tauri runs `npm run dev` in `apps/desktop` (Vite on `http://127.0.0.1:5173`, hot reload).
2. The Rust shell checks `127.0.0.1:47821`. If nothing listens, it starts the host with
   `node --import tsx packages/host/src/main.ts` from the repo root, and stops it when the window closes.
   If a host is already running it reuses it.
3. The window shows the Vite page; the Vite proxy forwards `/api` and `/media` to the host and injects its
   bearer token.

The first run compiles ~350 Rust crates (about 4 minutes); later runs take seconds. Changes to `.tsx` hot-reload.
Changes to `src-tauri/src/*.rs` rebuild and restart the window. Changes to host/core TypeScript need the
host restarted (close the window and run `npm run app` again).

### B. Browser only (fastest UI iteration, no Rust)

```bash
npm run dev
```

Runs the host (`:47821`) and Vite (`:5173`) together with `concurrently`. Open http://127.0.0.1:5173.
The native Import/Open/Save dialogs only appear in the desktop window; in the browser use the typed-path boxes.

You can also run the halves separately in two terminals: `npm run dev:host` and `npm run dev:ui`.

### C. Without FFmpeg (stubbed probe)

```bash
npx tsx scripts/dev-fake-host.ts     # host with a fake probe; prints a placeholder media path
npm run dev:ui
```

The placeholder file is not real video, so the preview stays black. This is for UI experiments only; real
imports need ffprobe.

## Driving the MCP server without Claude

```bash
node scripts/mcp-call.mjs get_project_state
node scripts/mcp-call.mjs split_clip '{"clipId":"clip_2","atFrame":120,"expectedRevision":1}'
```

This launches `packages/mcp/dist/index.js` over stdio exactly as Claude Code does and prints the tool result.
The editor (A or B) must be running. A quick manual end-to-end check:

1. Start the editor and import a video.
2. Run `get_project_state`; note `revision` and a clip id.
3. Run `split_clip` with that revision; the clip splits in the window and the header shows
   "Claude: split clip".

## Scripts reference

| Command | What it does |
| --- | --- |
| `npm run app` | Tauri dev window (starts Vite and host) |
| `npm run dev` | Host + Vite for browser-only development |
| `npm run dev:host` / `dev:ui` | Each half on its own |
| `npm run build:mcp` | Bundle the MCP server to `packages/mcp/dist/index.js` |
| `npm run build:ui` | Production Vite build to `apps/desktop/dist` |
| `npm run typecheck` | `tsc --noEmit` over all packages and tests |
| `npm test` | Vitest, all packages |
| `npm run version:check` / `version:set -- x.y.z` / `version:bump -- patch` | Application version management, see [VERSIONING.md](VERSIONING.md) |
| `npm run app:build` | Production installer, see [BUILDING.md](BUILDING.md) |
| `npm run app:build:exe` | Production exe without installer |

Rust-only checks: `cd apps/desktop/src-tauri && cargo check`.

## Environment variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `CE_PORT` | `47821` | host, Vite proxy | Host port. The Rust shell and Tauri capability file assume 47821, so change it only for browser-only dev. |
| `CE_STATE_DIR` | `%LOCALAPPDATA%\lumiere-pro` | host, MCP, Vite, Rust | Where `host.json` (port, token, pid) is written. The MCP server reads it to find the host. |
| `CE_FFPROBE` | `ffprobe` on PATH | host | Full path to an `ffprobe` executable. |
| `CE_UI_DIR` | `apps/desktop/dist` | host | Directory the host serves at `/` (set by the packaged app). |
| `CE_BUNDLE_FFPROBE` | unset | `scripts/prepare-bundle.mjs` | Path to an ffprobe.exe to bundle into the installer. |

## Tests

```bash
npm test                                  # everything
npx vitest run packages/core              # editing logic only, no UI, no network
npx vitest run apps/desktop/test          # MCP -> host -> UI store integration test
npx vitest                                # watch mode
```

| Suite | Covers |
| --- | --- |
| `packages/core/test` | split/trim/move/remove/undo/redo, overlap and bounds validation, revisions, subscriptions, project file round-trip and version rejection |
| `packages/host/test` | ffprobe JSON parsing, hostile path rejection, and a real ffprobe run (auto-skipped when `ffmpeg`/`ffprobe` are not on PATH) |
| `apps/desktop/test/integration.test.ts` | Starts the real host, the real UI store and a real stdio MCP server. Asserts that an MCP `split_clip` changes the UI store's project and the timeline layout with no UI call, that stale revisions are rejected, that UI and MCP share one undo history, auth, ranged media streaming and save/reopen |

The integration test is deterministic: it uses a stubbed probe and a temp directory, picks a free port and
cleans up after itself. It does not need the app, FFmpeg or Claude.

## Project conventions

- **All edits go through `ProjectStore.execute`.** New edit operations are added in
  `packages/core/src/commands.ts` (pure function) and the `CommandSchema` union, then exposed by a thin MCP tool
  in `packages/mcp/src/server.ts` and, if manual, a UI action. The MCP server and UI never hold project state.
- **Positions are integer project frames.** Never store seconds in the project.
- **stdout belongs to MCP.** In `packages/mcp`, log with `console.error` only.
- **Never write to source media.** The host opens media read-only; save targets are checked against media paths.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ffprobe was not found` on import | The process was started from a shell without FFmpeg on PATH. Open a new terminal, or set `CE_FFPROBE`. |
| Header shows "host offline" | Host not running or port busy. `npm run dev:host`, or free port 47821 (`Get-NetTCPConnection -LocalPort 47821`). |
| `[vite] http proxy error ... ECONNREFUSED` at startup | Vite came up before the host. Harmless; the UI reconnects within a few seconds. |
| `The Lumiere Pro app is not running` from an MCP tool | No `host.json`. Start the editor. The host deletes the file when it exits cleanly. |
| `STALE_REVISION` | Someone (you or Claude) edited since the revision was read. Re-run `get_project_state` and retry with the new revision. |
| `link.exe not found` / linker errors in `cargo` | VS C++ Build Tools missing. Install the "Desktop development with C++" workload. |
| `os error 32` / file in use during `app:build` | The built `lumiere-pro.exe` is still running. Close it and retry. |
| Tauri `file watcher error: EBUSY ... .pdb` | Benign on Windows during rebuilds. |
| MCP server missing in Claude Code | Run `npm run build:mcp`; start Claude Code from this folder; approve the project server when prompted. |
| Preview is black after importing | Media is not browser-playable (e.g. some codecs in `.avi`/`.mkv`). The timeline still works; the preview uses WebView2's codecs. |
