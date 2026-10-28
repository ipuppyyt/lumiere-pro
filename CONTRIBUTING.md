# Contributing to Lumiere Pro

Thanks for helping! Lumiere Pro is an open-source (Apache-2.0) video editor that Claude Code can control through MCP.
Bug reports, fixes, docs and well-scoped features are all welcome.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through
[SECURITY.md](SECURITY.md), not public issues.

## Ways to contribute

- **Report a bug** or **request a feature** using the issue templates. Search existing issues first.
- **Fix something:** comment on the issue so work is not duplicated, then open a pull request.
- **Large changes** (new tracks, effects, file-format or MCP tool changes): open an issue to discuss the design first.

## Development setup

Full details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Short version (Windows 10/11):

```bash
git clone https://github.com/ipuppyyt/lumiere-pro.git
cd lumiere-pro
npm ci
npm run build:mcp
npm run app          # desktop window; or `npm run dev` for browser-only
```

You need Node 20+, Rust with the MSVC toolchain and VS C++ Build Tools (for the desktop shell), and FFmpeg for importing
real media. UI and logic work needs only Node: `npm test` and `npm run dev` do not need Rust.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run version:check
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy -- -D warnings   # only if you touched Rust
```

CI runs the same checks. A pull request should:

- do one thing, with a clear description of what and why;
- include tests for behavior changes (editing logic lives in `packages/core` and is tested without any UI);
- update docs and `CHANGELOG.md` under **Unreleased** for anything user-visible;
- not change the version (maintainers do that at release time, see [docs/VERSIONING.md](docs/VERSIONING.md)).

## Architecture rules that reviews enforce

1. **Every edit goes through `ProjectStore.execute`.** The UI and the MCP server never mutate project state themselves.
2. **Timeline positions are integer project frames.**
3. **stdout belongs to the MCP protocol.** In `packages/mcp`, log with `console.error`.
4. **Never write to source media.** Media is opened read-only and save paths are checked against it.
5. **Validate at the boundary.** New MCP arguments get zod schemas; new paths go through `packages/host/src/paths.ts`.
6. **Compatibility surfaces are versioned.** Changing the project file format needs a migration and fixture; changing an
   MCP tool's schema or meaning is a breaking change. See [docs/VERSIONING.md](docs/VERSIONING.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit.

## Commit messages and pull requests

Use short, imperative subject lines ("Add trim validation for neighbouring clips"). Reference issues with `Fixes #123`.
Keep pull requests rebased on `main`; maintainers squash-merge.

## Licensing of contributions

Unless you state otherwise, any contribution you submit is licensed under the Apache License 2.0, as described in
section 5 of the license. You confirm you have the right to submit it. Do not paste code from projects with
incompatible licenses (for example GPL code), and do not add bundled binaries (such as FFmpeg) to the repository.
