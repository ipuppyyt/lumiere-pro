# Changelog

All notable changes to Lumiere Pro are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) as described in [docs/VERSIONING.md](docs/VERSIONING.md).

Every entry that changes the **project file format**, an **MCP tool**, or the **host API** must say so
explicitly, because those are compatibility surfaces.

## [Unreleased]

### Added
- Single-source versioning: `scripts/version.mjs` (`check`, `set`, `bump`), a generated `APP_VERSION`, and a
  version-consistency test.
- Project files record `savedWith` (the app version that wrote them) and are migrated through a versioned
  migration chain; a frozen format-1 fixture guards compatibility.
- `GET /api/version` on the host; the MCP server reports the app version; the UI header shows it.

## [0.1.0] - 2026-10-28

First working release.

### Added
- Single-track timeline with import, trim, split, move, delete, undo and redo, in integer project frames.
- Project revisions with stale-edit rejection; versioned JSON project files (format 1, `.lumiere.json`).
- MCP stdio server with `get_project_state`, `list_media`, `split_clip`, `trim_clip`, `move_clip`,
  `remove_clip`, `undo_edit`.
- Live UI updates for every edit, whether made by hand or by Claude.
- Tauri 2 desktop shell, native file dialogs, standalone Windows installer.

[Unreleased]: #
[0.1.0]: #
