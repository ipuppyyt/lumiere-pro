# Building the standalone production app

The production build is a self-contained Windows x64 app. It needs **nothing from this repository at run time**:
it ships its own Node.js runtime, the host, the MCP server and the UI. The only external dependency is FFmpeg's
`ffprobe` (see [ffprobe](#ffprobe)).

## What you get

| Command | Output |
| --- | --- |
| `npm run app:build` | NSIS installer: `apps/desktop/src-tauri/target/release/bundle/nsis/Lumiere Pro_0.1.0_x64-setup.exe` (about 25 MB) |
| `npm run app:build:exe` | Just `apps/desktop/src-tauri/target/release/lumiere-pro.exe` plus the folders next to it; no installer |

The installer was built and test-installed with a silent install into a scratch folder (`/S /D=<dir>`); the app
launched, imported real video and answered the bundled MCP server. That test install was then uninstalled.
The installer has **not** been run through the interactive wizard or tested on a second machine.

## Prerequisites

Everything in [DEVELOPMENT.md](DEVELOPMENT.md#prerequisites) (Node, Rust + MSVC Build Tools, WebView2) plus
network access on the first installer build, because Tauri downloads NSIS and one NSIS plugin from GitHub.
FFmpeg is **not** needed to build, only to import media at run time.

## Build

Set the version first (see [VERSIONING.md](VERSIONING.md) for the full release checklist):

```bash
npm run version:set -- 1.0.0     # or: npm run version:bump -- minor
npm install
npm run app:build
```

The installer and exe take their version from `tauri.conf.json`, which `version:set` keeps in sync. The build
refuses to start if any version field disagrees.

What happens:

0. `scripts/version.mjs check` verifies every version field agrees.
1. `vite build` produces `apps/desktop/dist`.
2. `scripts/prepare-bundle.mjs` stages everything under `apps/desktop/src-tauri/resources/`:
   - `node/node.exe` – copied from the Node that runs the build (so the app runs on the Node you built with)
   - `host/host.mjs` – single-file esbuild bundle of `packages/host`
   - `mcp/index.js` – single-file bundle of the stdio MCP server
   - `ui/` – the built UI
   - `ffmpeg/` – empty unless you set `CE_BUNDLE_FFPROBE`
3. `cargo` compiles the Rust shell in release mode (first build about 7 minutes; later ones 1–2 minutes).
4. Tauri bundles the resources and runs NSIS to create the installer.

`tauri.prod.conf.json` is merged over `tauri.conf.json` only for production builds; the dev window configuration
is untouched.

### How the packaged app runs

On launch the Rust shell starts the bundled `node.exe` on `host/host.mjs` (no console window), waits for the host,
then opens a window on `http://127.0.0.1:47821/`, which the host serves from `ui/`. The host's random token is
handed to the page by an init script. Closing the window stops the host. If a host is already listening on
47821 it is reused.

### Installed layout

```
<INSTALL_DIR>\lumiere-pro.exe
<INSTALL_DIR>\uninstall.exe
<INSTALL_DIR>\node\node.exe        about 90 MB, the runtime
<INSTALL_DIR>\host\host.mjs
<INSTALL_DIR>\mcp\index.js         what Claude Code launches
<INSTALL_DIR>\ui\                  web assets
<INSTALL_DIR>\ffmpeg\              ffprobe.exe only if you bundled it
```

Installed size is about 103 MB. By default Tauri installs per user; the folder is shown in the installer and in
the Start Menu shortcut's properties. (My test used a custom folder, so confirm the default path on your machine.)

### Exe without the installer

`npm run app:build:exe` produces `lumiere-pro.exe` next to `node\`, `host\`, `mcp\`, `ui\` and `ffmpeg\` in
`apps/desktop/src-tauri/target/release/`. To make a portable copy, copy the exe **and those five folders together**
(for example into a zip). The exe alone does not start.

## ffprobe

Imports need `ffprobe`. The app looks for it in this order: `ffmpeg\ffprobe.exe` inside the install folder, then
`ffprobe` on PATH (via `CE_FFPROBE` if set). Without it, import fails with a clear message and nothing else breaks.

- **Default:** do not bundle. Users install FFmpeg (`winget install Gyan.FFmpeg`). Note that a process only sees it
  if launched after PATH changed, so users may need to sign out/in or restart the app from a new shell once.
- **Bundle it:** `set CE_BUNDLE_FFPROBE=C:\path\to\ffprobe.exe` before `npm run app:build`. FFmpeg builds are
  usually GPL/LGPL; check the license of the build you ship and its redistribution terms before distributing.

## Registering MCP against the packaged app

The app ships a ready MCP server, so Claude Code does not need Node or this repository:

```bash
claude mcp add lumiere-pro --scope user -- "<INSTALL_DIR>\node\node.exe" "<INSTALL_DIR>\mcp\index.js"
claude mcp list
```

Start Lumiere Pro first; then ask Claude to call `get_project_state`. See [MCP.md](MCP.md).
This exact command pair (bundled `node.exe` + bundled `mcp\index.js`) was exercised against an installed copy.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `failed to bundle project: timeout: global` while "Downloading ... nsis-3.13.zip" | Tauri's downloader timed out. Retry. If it keeps failing, download the files yourself into `%LOCALAPPDATA%\tauri\NSIS` (see below). |
| `os error 32` (file in use) during build | `lumiere-pro.exe` is still running. Close it. |
| App starts then shows "The editor host did not start" | Port 47821 is taken by another program. Free it. |
| "bundled runtime is missing" | The folders next to the exe were not copied with it. |
| Import says ffprobe not found | See [ffprobe](#ffprobe). |
| Windows SmartScreen warns on the installer | The build is not code-signed. Sign it (below) for distribution. |

### Offline/manual NSIS cache

Tauri pins these downloads by SHA-1. Place them so that the folder `%LOCALAPPDATA%\tauri\NSIS` contains the
extracted `nsis-3.13.zip` contents and the plugin file:

| File | URL | SHA-1 |
| --- | --- | --- |
| `nsis-3.13.zip` (extract, rename the folder `nsis-3.13` to `NSIS`) | `https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip` | `DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E` |
| `nsis_tauri_utils.dll` → `NSIS\Plugins\x86-unicode\additional\` | `https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll` | `75197FEE3C6A814FE035788D1C34EAD39349B860` |

Verify with `Get-FileHash <file> -Algorithm SHA1`. (These matched when this project was built; a newer Tauri CLI
may pin different versions, in which case its error text names them.)

## Before distributing

- **Version:** bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and `Cargo.toml`, `package.json`).
- **Code signing:** not configured. Add a certificate via Tauri's `bundle.windows` signing settings.
- **Bundled Node:** the installer embeds the Node you built with. Rebuild to pick up Node security updates.
- **Updates:** there is no auto-updater. Users reinstall the new setup.exe.
- **Platform:** Windows x64 only. The shell and bundling script assume Windows.
