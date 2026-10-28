# MCP server

Transport: local **stdio**. The server is stateless; each tool call is forwarded to the running editor, which owns
the project. If the editor is not running, tools return `EDITOR_UNAVAILABLE`.

## Registering with Claude Code

### Development (this repository)

`.mcp.json` at the repo root already declares it:

```json
{ "mcpServers": { "lumiere-pro": { "type": "stdio", "command": "node", "args": ["packages/mcp/dist/index.js"] } } }
```

```bash
npm run build:mcp
claude            # start from the repo root, approve the project MCP server when asked
```

Check with `claude mcp list` (should show `lumiere-pro`), or `/mcp` inside a session.

### Against the installed/standalone app

The packaged app ships its own Node and a bundled MCP server, so nothing else needs installing. Register it once
per user with absolute paths to the install folder (see [BUILDING.md](BUILDING.md#registering-mcp-against-the-packaged-app)):

```bash
claude mcp add lumiere-pro --scope user -- "<INSTALL_DIR>\node\node.exe" "<INSTALL_DIR>\mcp\index.js"
```

Start the editor first, then use Claude Code from any folder.

### Optional override

Set `CE_STATE_DIR` in the server's `env` if the editor was started with a non-default state directory.

## Revision rules

Every project has an integer `revision` that increases by one on every committed change (edit, undo, redo, open).
Every editing tool takes `expectedRevision`. If it does not equal the current revision the call is rejected with
`STALE_REVISION` and nothing changes; the error includes `currentRevision`. Read the state again and retry.
This protects Claude from editing a timeline you have changed in the meantime.

All frame values are **integers in project frames** (the project frame rate is returned by `get_project_state`).
The timeline has one track; clips may not overlap; gaps are allowed.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_project_state` | none | `revision`, `fps`, duration, `media[]`, `clips[]` (sorted by start) |
| `list_media` | none | `revision`, `fps`, `media[]` with duration, size, frame rate, `audioStreams[]` |
| `split_clip` | `clipId`, `atFrame`, `expectedRevision` | Cuts at a timeline frame strictly inside the clip. Left part keeps the id; right part gets a new id. |
| `trim_clip` | `clipId`, `side` (`start`\|`end`), `toFrame`, `expectedRevision` | Moves one edge to a timeline frame. May re-extend into previously trimmed source, never past the source or into a neighbour. |
| `move_clip` | `clipId`, `startFrame`, `expectedRevision` | Moves the clip. Rejected on overlap. |
| `remove_clip` | `clipId`, `expectedRevision` | Deletes the clip, leaving a gap. Source media is untouched. |
| `undo_edit` | `expectedRevision` | Undoes the most recent edit by anyone. Undo is itself a revision. |

Successful edits return:

```json
{ "ok": true, "revision": 2, "affectedClipIds": ["clip_2", "clip_3"], "affectedClips": [ { "id": "clip_2", "mediaId": "media_1", "startFrame": 0, "inFrame": 0, "durationFrames": 120 } ] }
```

`inFrame` is the first source frame used by the clip.

## Errors

Failures set `isError: true` and return `{ "ok": false, "code": "...", "message": "..." }`.

| Code | Meaning |
| --- | --- |
| `STALE_REVISION` | Project changed since `expectedRevision`; includes `currentRevision`. |
| `NOT_FOUND` | Unknown clip id. |
| `INVALID_ARGUMENT` | Bad value: split on a clip edge, trim past an edge or the source, no-op edit, non-integer frame. |
| `OVERLAP` | Edit would make two clips overlap. |
| `NOTHING_TO_UNDO` | Undo history is empty. |
| `EDITOR_UNAVAILABLE` | The editor app is not running. |

Schema violations (wrong types, negative or fractional frames) are rejected by the MCP layer before reaching the editor.

## Not exposed to Claude

Import, save and open are user actions in the app. Claude cannot read or write arbitrary files through this server.
