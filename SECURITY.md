# Security policy

## Supported versions

Lumiere Pro is pre-1.0. Security fixes are made on the latest release only.

| Version | Supported |
| --- | --- |
| latest release | yes |
| older releases | no, please update |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private reporting: **[Security → Report a vulnerability](https://github.com/ipuppyyt/lumiere-pro/security/advisories/new)** on this repository. Include the version
(shown in the app header and `GET /api/version`), your Windows version, steps to reproduce, and the impact you see.

You can expect an acknowledgement within a few days and a status update once the report has been triaged. Fixes are
released as a patch version, and reporters are credited in the changelog unless they prefer not to be.

## What is in scope

Lumiere Pro is a local desktop app. Things we treat as vulnerabilities include:

- a web page or another local user being able to drive the editor host without the token (the host binds to
  `127.0.0.1`, checks the `Host` header and requires a bearer token);
- path validation bypasses that let import/open/save read or write files they should not, or overwrite source media;
- ways for MCP input to run commands, escape validation or read arbitrary files;
- crashes or memory-safety issues triggered by crafted project files or media metadata;
- supply-chain problems in the release installer or its bundled runtime.

## Known limits (by design)

- Any process running as the same Windows user can read `%LOCALAPPDATA%\lumiere-pro\host.json` and therefore use the
  host. The token protects against other users and web pages, not against malware already running as you.
- Media is decoded by the system WebView2 and inspected by your installed `ffprobe`; vulnerabilities in those belong to
  their vendors, though we want to hear about ways Lumiere Pro makes them easier to trigger.
- Release installers are not yet code-signed, so Windows SmartScreen will warn. Verify downloads against the SHA-256
  checksum published with each release.

The threat model is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
