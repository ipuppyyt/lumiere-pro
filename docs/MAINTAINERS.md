# Maintainer guide

One-time repository settings that cannot live in the repository itself.

## After creating the GitHub repository

1. **[Settings → General](https://github.com/ipuppyyt/lumiere-pro/settings):** set the description ("Local-first video editor Claude Code can control through MCP"),
   add topics (`video-editor`, `mcp`, `claude-code`, `tauri`, `typescript`, `rust`, `ffmpeg`, `windows`), enable
   Issues and Discussions, and under *Pull Requests* allow **squash merging only** and enable *automatically delete
   head branches*.
2. **[Settings → Code security](https://github.com/ipuppyyt/lumiere-pro/settings/security_analysis):** enable **Private vulnerability reporting** (SECURITY.md and the Code of Conduct point
   to it), Dependabot alerts, Dependabot security updates and secret scanning.
3. **[Settings → Branches](https://github.com/ipuppyyt/lumiere-pro/settings/branches) → Add rule for `main`:** require a pull request, require the status checks
   `Typecheck and test` and `Rust shell and UI build`, require branches to be up to date, and block force pushes.
   (Checks only appear in the list after CI has run once.)
4. **Settings → Actions → General:** workflow permissions *Read repository contents*; the release workflow requests
   `contents: write` itself.
5. `.github/CODEOWNERS` assigns review to @ipuppyyt; enable *Require review from Code Owners* in the branch rule if you want it enforced.

## Dependabot pull requests

Dependabot may propose **major** upgrades that this project deliberately holds back, for example TypeScript 5.9 to 7.x.
Test them before merging, and close ones that are not ready (Dependabot will stop proposing that version).

## Cutting a release

Follow the checklist in [VERSIONING.md](VERSIONING.md#release-checklist). Pushing a tag `vX.Y.Z` runs
`.github/workflows/release.yml`, which verifies the tag equals the package version, runs the tests, builds the
installer and creates a **draft** GitHub release containing the installer, its SHA-256 and the matching
`CHANGELOG.md` section. Review the draft, then publish it.

CI runs on every pull request. The release workflow has not run yet; expect to fix small things the first time you push a tag (try a `-rc.1` tag first, which creates a draft prerelease).

## Housekeeping

- Dependabot opens weekly update pull requests; CI must pass before merging.
- Rebuild and release a patch when Node.js ships a security update (the installer embeds Node).
- Releases are not code-signed. Before wider distribution consider an OV/EV certificate or Azure Trusted Signing.
