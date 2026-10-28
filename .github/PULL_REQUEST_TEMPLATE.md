## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## How it was tested

<!-- Tests added, and anything you tried by hand (desktop app, MCP tool call, real media). -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass
- [ ] Behavior changes have tests (editing logic is tested in `packages/core` without UI)
- [ ] Docs and `CHANGELOG.md` (Unreleased) updated for user-visible changes
- [ ] Rust changes: `cargo fmt --check` and `cargo clippy -- -D warnings` pass
- [ ] Does **not** change the version number (maintainers do that at release)
- [ ] Project file format or MCP tool schema change? A migration/fixture is included, or the breaking change is called out in the changelog
- [ ] No source media is written, and no binaries or private media are committed
