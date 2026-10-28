# Versioning and releases

Lumiere Pro uses [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH[-prerelease]`.

## One source of truth

The version is the `version` field of the **root `package.json`**. Never edit versions by hand; run:

```bash
npm run version:check                  # verify every file agrees (also runs in tests and before app:build)
npm run version:set -- 1.2.0           # set an exact version everywhere
npm run version:bump -- patch          # 0.1.0 -> 0.1.1
npm run version:bump -- minor          # 0.1.1 -> 0.2.0
npm run version:bump -- major          # 0.2.0 -> 1.0.0
npm run version:bump -- prerelease     # 1.0.0 -> 1.0.1-rc.1 -> 1.0.1-rc.2 ...
npm run version:bump -- prerelease beta   # use a different identifier
```

Bumping `patch`/`minor`/`major` from a prerelease promotes it (`1.0.1-rc.2` + patch = `1.0.1`).

`set` and `bump` write the same value to:

| File | Why |
| --- | --- |
| `package.json` (root) | the source of truth |
| `packages/core`, `host`, `mcp`, `apps/desktop` `package.json` | workspace packages |
| `package-lock.json` | workspace entries, so `npm ci` stays consistent |
| `apps/desktop/src-tauri/tauri.conf.json` | installer name, Windows exe/installer metadata |
| `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock` | Rust crate version |
| `packages/core/src/version.ts` | generated `APP_VERSION` compiled into the UI, host and MCP server |

Where the version shows up at run time:

- the UI header (`v0.1.0`);
- the MCP server's `serverInfo.version` (visible to Claude Code in `/mcp`);
- `GET /api/version` on the host: `{ "app": "Lumiere Pro", "version": "…", "projectFormat": 1 }`;
- `savedWith` inside every saved project file;
- the installer file name and the Windows file properties of `lumiere-pro.exe`.

Three guards keep it consistent: `npm test` fails if any file drifts, `npm run app:build` runs
`version:check` before compiling, and `set`/`bump` update everything in one step.

## What the numbers mean

Lumiere Pro has three compatibility surfaces besides its UI. Changing them has rules:

| Surface | Breaking change means | Required version bump |
| --- | --- | --- |
| **Project file format** (`formatVersion`) | a layout change old builds cannot read | add a migration, bump `FORMAT_VERSION`, and at least a **minor** release (a **major** if old projects cannot be migrated) |
| **MCP tools** (names, arguments, result shape) | removing or renaming a tool/argument, changing meaning | **major** (after 1.0). While `0.x`, a **minor** with a changelog note |
| **Host HTTP API** | changing routes used by the UI and MCP server | they ship together, so **minor**; never exposed to users |

Additive changes (a new optional argument, a new tool, a new optional file field) are **minor**. Bug fixes and
internal changes are **patch**. While the version is `0.x`, minor releases may include breaking changes; the changelog
must call them out. Go to `1.0.0` when the file format and MCP tools are considered stable.

### Project file format versus app version

`FORMAT_VERSION` (in `packages/core/src/model.ts`) is a separate integer that only changes when the saved layout
changes. App versions advance much more often than format versions. A file records both:

```json
{ "formatVersion": 1, "savedWith": "0.1.0", … }
```

- **Older file, newer app:** opened through the migration chain (`packages/core/src/persist.ts`). The file on disk
  is not modified until the user saves.
- **Newer file, older app:** refused with a message naming the version that wrote it and asking to update. The file
  is never partially read or overwritten.

### Changing the file format

1. Increase `FORMAT_VERSION`.
2. Add `MIGRATIONS[<old version>]` that upgrades a raw object by one step and sets the new `formatVersion`.
3. Keep every existing fixture in `packages/core/test/fixtures` loading; add a fixture for the new format.
4. Update `docs/ARCHITECTURE.md` and the changelog; bump the app version as in the table above.

The golden-fixture test (`persist.test.ts`) fails if an old file stops opening.

## Release checklist

1. All work merged; `npm run typecheck` and `npm test` pass.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading. State any
   file-format, MCP or host API changes.
3. `npm run version:set -- x.y.z` (or `version:bump`). `npm run version:check` must pass.
4. `npm run build:mcp` and `npm run app:build`. The installer is
   `apps/desktop/src-tauri/target/release/bundle/nsis/Lumiere Pro_x.y.z_x64-setup.exe`.
5. Smoke test the installer build: launch, import a video, make an edit by hand and one through MCP, save and reopen.
6. Commit as `Release x.y.z`, tag `vx.y.z`, and keep the installer with the tag.

## Notes and limits

- Prerelease versions (`1.0.0-rc.1`) are valid SemVer and are accepted by the NSIS installer used here. An MSI target
  would not accept them; this project builds NSIS only.
- The installer embeds the Node runtime it was built with. Rebuild and release when Node ships a security update, even if
  no application code changed (a **patch** release).
- There is no auto-updater, so users install each new setup file. The installer keeps the same app identifier across versions, so it is expected to upgrade in place; that upgrade path has not been tested yet.
- No CI pipeline or git repository is set up in this folder yet; tagging and release automation are manual until one exists.
