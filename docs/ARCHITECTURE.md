# Architecture

```
Claude Code ──stdio──▶ packages/mcp ──HTTP + bearer token──▶ packages/host ◀──HTTP + SSE── UI (React + Zustand)
                       (stateless)                            ProjectStore                   in a Tauri window
                                                              (the command service)          or a browser
                                                              ffprobe · media streaming · save/open
                                                              packages/core
```

The Rust shell (`apps/desktop/src-tauri`) starts and stops the host, shows the window, and provides native file
dialogs. It does not hold project state.

## Components

**`packages/core`** – pure TypeScript, no I/O. The project model (zod schemas), the command functions
(`import_media`, `split_clip`, `trim_clip`, `move_clip`, `remove_clip`), `ProjectStore` (revision counter, undo/redo
snapshots, stale-revision rejection, subscriptions) and the project file parser/serializer.

**`packages/host`** – Node process; owns the single `ProjectStore`. Loopback HTTP server:

| Route | Purpose |
| --- | --- |
| `GET /api/state` | current snapshot |
| `GET /api/events` | Server-Sent Events: a snapshot after every committed transaction |
| `POST /api/command` | `{ command, expectedRevision, origin }` into `ProjectStore.execute` |
| `POST /api/media/import` | validate path, run ffprobe, then an `import_media` command |
| `POST /api/project/save`, `/open` | versioned JSON project files |
| `GET /api/session` | read-only media token for `<video>` |
| `GET /media/:id` | ranged, read-only streaming of source media |
| everything else | static UI files when a UI directory is configured |

**`packages/mcp`** – MCP stdio server. Each tool validates its input with zod and calls `POST /api/command` with
`origin: "claude"`. It finds the host through `host.json` in the state directory.

**`apps/desktop`** – the UI. `createEditorStore(transport)` is a Zustand store that mirrors host snapshots. Manual
edits call the same `/api/command` endpoint; there is no second code path. The timeline renders
`selectTimelineLayout(project, zoom)`; the integration test asserts on that same function.

## Data flow of one AI edit

1. Claude calls `split_clip` with `expectedRevision: 1`.
2. The MCP server forwards it to the host.
3. `ProjectStore.execute` checks the revision, validates and applies the command, pushes an undo snapshot,
   bumps the revision to 2 and notifies subscribers (one transaction).
4. The host writes the new snapshot to every SSE client.
5. The UI store receives it, the timeline and preview re-render, and the header shows "Claude: split clip".
6. The MCP tool returns the new revision and affected clip ids.

## Project file

`*.lumiere.json`, written atomically (temp file then rename):

```json
{
  "formatVersion": 1, "id": "…", "name": "Untitled", "revision": 7,
  "fps": { "num": 30, "den": 1 }, "nextId": 5,
  "media": [ { "id": "media_1", "path": "C:\\…\\a.mp4", "durationFrames": 300, "width": 1920, "height": 1080,
               "fps": { "num": 30, "den": 1 }, "audioStreams": [ … ], … } ],
  "clips": [ { "id": "clip_2", "mediaId": "media_1", "startFrame": 0, "inFrame": 0, "durationFrames": 120 } ]
}
```

- All timeline values are integer project frames. The project frame rate is taken from the first imported media;
  media with a different rate is converted by rounding.
- `formatVersion` is checked on open: newer files are refused, older ones go through a migration step (none exist yet).
- Undo history is not saved. Opening a project keeps the revision counter increasing and clears history.
- Media is referenced by absolute path; opening reports media that no longer exists.

## Security model

- The host binds to `127.0.0.1` only, rejects any `Host` header other than loopback (DNS rebinding) and requires a
  random per-run bearer token on `/api/*` and `/media/*`. The token lives in `host.json` and is handed to the
  window by the Rust shell (production) or the Vite dev proxy (development); it never appears in a URL.
- `<video>` cannot send headers, so `/media/*` also accepts a separate read-only token in `?t=`. It is rejected on
  every other route.
- Media paths must be absolute, local (no UNC/device paths, no `..`), existing regular files with an allow-listed
  extension. Project paths must end in `.lumiere.json`; saving over a source media file is refused.
- Source media is only ever opened for reading.
- ffprobe is run with `execFile` and a fixed argument list, never through a shell, with a timeout and output cap.
- The MCP server cannot import, save or open files, so Claude cannot make the editor read or write arbitrary paths.
- This is local-machine protection. Any local process running as you can read `host.json`.
