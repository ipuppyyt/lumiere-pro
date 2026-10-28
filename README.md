# Lumiere Pro

A local-first Windows video editor whose timeline Claude Code can edit live through MCP. Every edit, from your
mouse or from Claude, goes through one command service, so the open window always shows the real project state.

| Doc | What it covers |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Prerequisites, every dev command, tests, environment variables, troubleshooting |
| [docs/BUILDING.md](docs/BUILDING.md) | Building the standalone production app and installer, what is inside it, registering MCP against it |
| [docs/MCP.md](docs/MCP.md) | Registering the MCP server with Claude Code, tool reference, error codes, revision rules |
| [docs/VERSIONING.md](docs/VERSIONING.md) | One-source versioning, bump commands, compatibility rules, release checklist |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, project file format, security model |

## Quick start (development)

```bash
npm install
npm run build:mcp      # bundles the MCP server that .mcp.json points at
npm run app            # Tauri dev window (starts Vite and the host for you)
```

Then, in a Claude Code session started in this folder, approve the `lumiere-pro` MCP server and ask:
*"Call get_project_state, then split the first clip at frame 90."* The clip splits in the open window.

Prerequisites (Node, Rust + MSVC Build Tools, FFmpeg, WebView2) are listed in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#prerequisites).

## Quick start (standalone app)

```bash
npm run app:build      # installer: apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe
```

Details, outputs and caveats: [docs/BUILDING.md](docs/BUILDING.md).

## What works

Import (native dialog or typed path) · ffprobe inspection (duration, size, frame rate, audio streams) · source
preview · single-track timeline · trim, split, move, delete, undo, redo · integer-frame timeline · versioned JSON
project save/open · project revision numbers with stale-edit rejection · seven MCP tools · live UI updates.

## Not in scope yet

Multi-track editing, effects, audio editing, export/render, analysis jobs, code signing, non-Windows platforms.
The timeline is one track; clips cannot overlap.

## Repository layout

```
packages/core     project model, commands, undo/redo, revisions, file format (pure TypeScript)
packages/host     loopback HTTP+SSE server owning the one ProjectStore; ffprobe, paths, media streaming
packages/mcp      stateless stdio MCP server forwarding tool calls to the host
apps/desktop      React + Zustand UI and the Tauri 2 shell (src-tauri/, Rust)
scripts/          bundling script, dev helpers
docs/             documentation
```

## Contributing, license and security

Lumiere Pro is open source under the [Apache License 2.0](LICENSE) (see also [NOTICE](NOTICE)).
Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Maintainers: see
[docs/MAINTAINERS.md](docs/MAINTAINERS.md).
