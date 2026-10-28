import { promises as fs } from "node:fs";
import path from "node:path";
import { EditError } from "@lumiere-pro/core";

export const MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
export const PROJECT_SUFFIX = ".lumiere.json";

function baseCheck(p: unknown, what: string): string {
  if (typeof p !== "string" || p.length === 0 || p.length > 1024) {
    throw new EditError("INVALID_PATH", `${what} path must be a non-empty string`);
  }
  if (p.includes("\0")) throw new EditError("INVALID_PATH", `${what} path contains a NUL byte`);
  if (p.startsWith("\\\\") || p.startsWith("//")) {
    throw new EditError("INVALID_PATH", `${what} path must be a local absolute path (UNC/device paths are not allowed)`);
  }
  if (!path.isAbsolute(p)) throw new EditError("INVALID_PATH", `${what} path must be absolute`);
  if (p.split(/[\\/]/).includes("..")) throw new EditError("INVALID_PATH", `${what} path must not contain ".."`);
  return path.normalize(p);
}

/** Returns the real path of an existing, regular, allow-listed media file. Read-only use only. */
export async function validateMediaPath(p: unknown): Promise<string> {
  const norm = baseCheck(p, "Media");
  const ext = path.extname(norm).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) {
    throw new EditError("INVALID_PATH", `Unsupported media extension "${ext}". Allowed: ${[...MEDIA_EXTENSIONS].join(", ")}`);
  }
  let real: string;
  try {
    real = await fs.realpath(norm);
    const st = await fs.stat(real);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    throw new EditError("INVALID_PATH", `Media file does not exist or is not a regular file: ${norm}`);
  }
  return real;
}

/** Validates a project file path for open (must exist) or save (parent must exist, must not clobber media). */
export async function validateProjectPath(
  p: unknown,
  mode: "open" | "save",
  protectedMedia: readonly string[],
): Promise<string> {
  const norm = baseCheck(p, "Project");
  if (!norm.toLowerCase().endsWith(PROJECT_SUFFIX)) {
    throw new EditError("INVALID_PATH", `Project files must end with ${PROJECT_SUFFIX}`);
  }
  if (mode === "open") {
    try {
      const real = await fs.realpath(norm);
      if (!(await fs.stat(real)).isFile()) throw new Error();
      return real;
    } catch {
      throw new EditError("INVALID_PATH", `Project file does not exist: ${norm}`);
    }
  }
  let dir: string;
  try {
    dir = await fs.realpath(path.dirname(norm));
    if (!(await fs.stat(dir)).isDirectory()) throw new Error();
  } catch {
    throw new EditError("INVALID_PATH", `Directory does not exist: ${path.dirname(norm)}`);
  }
  const target = path.join(dir, path.basename(norm));
  const lower = target.toLowerCase();
  if (protectedMedia.some((m) => m.toLowerCase() === lower)) {
    throw new EditError("INVALID_PATH", "Refusing to overwrite a source media file");
  }
  return target;
}

/** Atomic text write: temp file in the same directory, then rename. */
export async function writeFileAtomic(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new EditError("IO_ERROR", `Could not write ${target}: ${(e as Error).message}`);
  }
}
