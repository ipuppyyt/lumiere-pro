import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repo, "scripts/release-notes.mjs");

const SAMPLE = `# Changelog

## [Unreleased]

### Added
- upcoming thing

## [1.2.0] - 2026-01-01

### Added
- Shiny feature

### Fixed
- A bug

## [1.1.0] - 2025-12-01

- old

[Unreleased]: #
[1.2.0]: #
`;

function notes(changelog: string, version: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ce-rn-"));
  const file = path.join(dir, "CHANGELOG.md");
  writeFileSync(file, changelog);
  try {
    return { out: execFileSync(process.execPath, [script, version, "--changelog", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), status: 0 };
  } catch (e) {
    return { out: "", status: (e as { status: number }).status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("release-notes script", () => {
  it("extracts exactly one version's section", () => {
    const r = notes(SAMPLE, "1.2.0");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Shiny feature");
    expect(r.out).toContain("A bug");
    expect(r.out).not.toContain("old");
    expect(r.out).not.toContain("upcoming");
    expect(r.out).not.toMatch(/^\[1\.2\.0\]:/m);
  });
  it("fails when the version has no section or an empty one", () => {
    expect(notes(SAMPLE, "9.9.9").status).toBe(1);
    expect(notes("## [2.0.0] - 2026-01-01\n\n## [1.0.0]\n- x\n", "2.0.0").status).toBe(1);
  });
  it("does not confuse 1.2.0 with 1.2.01 or regex characters", () => {
    expect(notes(SAMPLE, "1.2.").status).toBe(1);
    expect(notes(SAMPLE, "1x2x0").status).toBe(1);
  });
  it("the real CHANGELOG has notes for the current release", () => {
    const v = JSON.parse(execFileSync(process.execPath, ["-p", "JSON.stringify(require('./package.json').version)"], { cwd: repo, encoding: "utf8" }));
    const out = execFileSync(process.execPath, [script, v], { encoding: "utf8" });
    expect(out.trim().length).toBeGreaterThan(10);
  });
});
