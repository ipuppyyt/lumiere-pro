import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repo, "scripts/version.mjs");
const run = (root: string, ...args: string[]) =>
  execFileSync(process.execPath, [script, ...args, "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const fails = (root: string, ...args: string[]) => {
  try {
    run(root, ...args);
    return null;
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { status: err.status, stderr: err.stderr };
  }
};

const FILES = [
  "package.json",
  "package-lock.json",
  "packages/core/package.json",
  "packages/host/package.json",
  "packages/mcp/package.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "packages/core/src/version.ts",
];

describe("version consistency in this repository", () => {
  it("every file agrees with the root package.json (run `npm run version:set -- <v>` if not)", () => {
    expect(run(repo, "check")).toMatch(/All version fields agree/);
  });
  it("the compiled-in APP_VERSION is the package.json version", () => {
    expect(APP_VERSION).toBe(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version);
  });
});

describe("version script on a scratch copy", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ce-ver-"));
    for (const f of FILES) {
      if (!existsSync(path.join(repo, f))) continue;
      mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      cpSync(path.join(repo, f), path.join(tmp, f));
    }
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("set updates every location and check passes", () => {
    run(tmp, "set", "2.3.4-rc.1");
    expect(run(tmp, "check")).toMatch(/2\.3\.4-rc\.1/);
    expect(readFileSync(path.join(tmp, "apps/desktop/src-tauri/Cargo.toml"), "utf8")).toMatch(/^version = "2\.3\.4-rc\.1"/m);
    expect(readFileSync(path.join(tmp, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")).toMatch(/"version": "2\.3\.4-rc\.1"/);
    expect(readFileSync(path.join(tmp, "packages/core/src/version.ts"), "utf8")).toMatch(/APP_VERSION = "2\.3\.4-rc\.1"/);
    expect(readFileSync(path.join(tmp, "apps/desktop/src-tauri/Cargo.lock"), "utf8")).toMatch(/name = "lumiere-pro"\r?\nversion = "2\.3\.4-rc\.1"/);
  });

  it("check names the file that drifted", () => {
    const f = path.join(tmp, "packages/host/package.json");
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    pkg.version = "0.0.1";
    writeFileSync(f, JSON.stringify(pkg));
    const r = fails(tmp, "check");
    expect(r?.status).toBe(1);
    expect(r?.stderr).toMatch(/packages\/host\/package\.json: 0\.0\.1/);
    run(tmp, "set", "2.3.4-rc.1"); // heal
    expect(fails(tmp, "check")).toBeNull();
  });

  it("bump follows SemVer, including prerelease transitions", () => {
    const v = () => JSON.parse(readFileSync(path.join(tmp, "package.json"), "utf8")).version as string;
    run(tmp, "set", "1.4.2");
    run(tmp, "bump", "patch");
    expect(v()).toBe("1.4.3");
    run(tmp, "bump", "minor");
    expect(v()).toBe("1.5.0");
    run(tmp, "bump", "major");
    expect(v()).toBe("2.0.0");
    run(tmp, "bump", "prerelease");
    expect(v()).toBe("2.0.1-rc.1");
    run(tmp, "bump", "prerelease");
    expect(v()).toBe("2.0.1-rc.2");
    run(tmp, "bump", "patch"); // promote the rc
    expect(v()).toBe("2.0.1");
    run(tmp, "set", "3.0.0-beta.2");
    run(tmp, "bump", "major"); // promote 3.0.0-beta.2 -> 3.0.0
    expect(v()).toBe("3.0.0");
    expect(fails(tmp, "check")).toBeNull();
  });

  it("rejects invalid versions and leaves files untouched", () => {
    const before = readFileSync(path.join(tmp, "package.json"), "utf8");
    for (const bad of ["1.2", "v1.2.3", "01.2.3", "1.2.3.4", "latest"]) {
      expect(fails(tmp, "set", bad)?.status).toBe(2);
    }
    expect(readFileSync(path.join(tmp, "package.json"), "utf8")).toBe(before);
    expect(fails(tmp, "bump", "huge")?.status).toBe(2);
  });
});
