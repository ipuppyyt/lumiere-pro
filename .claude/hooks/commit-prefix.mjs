#!/usr/bin/env node
// PreToolUse hook for Bash: blocks `git commit` when the message subject lacks a type prefix.
// Accepted: <type>[(scope)][!]: <subject>   e.g.  feat: add ripple delete   fix(core): reject empty split
// Exit 2 blocks the call and returns the message on stderr to Claude. Anything it cannot parse is allowed.
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "patch", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci", "revert", "release"];
const PREFIX = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: \\S`);

export function commitSubject(command) {
  if (!/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) return { isCommit: false };
  if (/--no-edit\b/.test(command) && !/(^|\s)(-m|--message)\b/.test(command)) return { isCommit: true, subject: null };

  // Heredoc: -F - <<'EOF' ... EOF   or   -m "$(cat <<'EOF' ... EOF)"
  const here = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2\b/.exec(command);
  if (here) return { isCommit: true, subject: firstLine(here[3]) };

  const m = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command);
  if (m) return { isCommit: true, subject: firstLine(m[1] ?? m[2] ?? m[3] ?? "") };
  return { isCommit: true, subject: null }; // editor / -F file: cannot verify
}

const firstLine = (s) => s.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";

export function verdict(command) {
  const { isCommit, subject } = commitSubject(command);
  if (!isCommit || subject === null) return null;
  if (PREFIX.test(subject)) return null;
  return (
    `Commit blocked: the subject "${subject}" has no type prefix.\n` +
    `Start every commit message with one of: ${TYPES.map((t) => t + ":").join(" ")}\n` +
    `Optional scope and breaking marker are allowed: feat(core): ..., fix!: ...\n` +
    `Examples: "feat: add ripple delete", "fix(host): reject UNC media paths", "chore: bump dependencies".\n` +
    `Reword the message and commit again.`
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const command = input?.tool_input?.command;
  if (typeof command === "string") {
    const problem = verdict(command);
    if (problem) {
      console.error(problem);
      process.exit(2);
    }
  }
}
