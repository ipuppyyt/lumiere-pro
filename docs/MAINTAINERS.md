# Maintainer guide

One-time repository settings that cannot live in the repository itself.

## After creating the GitHub repository

1. **Settings → General:** set the description ("Local-first video editor Claude Code can control through MCP"),
   add topics (`video-editor`, `mcp`, `claude-code`, `tauri`, `typescript`, `rust`, `ffmpeg`, `windows`), enable
   Issues and Discussions, and under *Pull Requests* allow **squash merging only** and enable *automatically delete
   head branches*.
2. **Settings → Code security:** enable **Private vulnerability reporting** (SECURITY.md and the Code of Conduct point
   to it), Dependabot alerts, Dependabot security updates and secret scanning.
3. **Settings → Branches → Add rule for `main`:** require a pull request, require the status checks
   `Typecheck and test` and `Rust shell and UI build`, require branches to be up to date, and block force pushes.
   (Checks only appear in the list after CI has run once.)
4. **Settings → Actions → General:** workflow permissions *Read repository contents*; the release workflow requests
   `contents: write` itself.
5. Optionally add a `CODEOWNERS` file with your GitHub username once it is known.

## Cutting a release

Follow the checklist in [VERSIONING.md](VERSIONING.md#release-checklist). Pushing a tag `vX.Y.Z` runs
`.github/workflows/release.yml`, which verifies the tag equals the package version, runs the tests, builds the
installer and creates a **draft** GitHub release containing the installer, its SHA-256 and the matching
`CHANGELOG.md` section. Review the draft, then publish it.

The workflows were written but have not run on GitHub yet. Expect to fix small things on the first run.

## Housekeeping

- Dependabot opens weekly update pull requests; CI must pass before merging.
- Rebuild and release a patch when Node.js ships a security update (the installer embeds Node).
- Releases are not code-signed. Before wider distribution consider an OV/EV certificate or Azure Trusted Signing.
