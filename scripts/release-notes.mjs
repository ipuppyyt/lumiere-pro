#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, for use as GitHub release notes.
//   node scripts/release-notes.mjs 0.2.0 [--changelog path]
// Exits 1 if the section is missing or empty, so a release cannot be cut without notes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function extractNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^## \\[${esc}\\]`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .replace(/^\[[^\]]+\]: .*$/gm, "") // trailing link reference definitions
    .trim();
  return body.length ? body : null;
}

function main(argv) {
  const args = [...argv];
  const ci = args.indexOf("--changelog");
  let file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../CHANGELOG.md");
  if (ci >= 0) {
    file = path.resolve(args[ci + 1] ?? "");
    args.splice(ci, 2);
  }
  const version = args[0];
  if (!version) {
    console.error("usage: release-notes.mjs <version>");
    process.exit(2);
  }
  const notes = extractNotes(readFileSync(file, "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no non-empty "## [${version}]" section. Add release notes before tagging.`);
    process.exit(1);
  }
  console.log(notes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
