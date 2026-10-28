import { applyEdit, CommandSchema, type Command } from "./commands";
import { EditError } from "./errors";
import { emptyContent, FORMAT_VERSION, type Content, type Project } from "./model";

export type Origin = "ui" | "claude" | "system";

export interface Change {
  kind: Command["type"] | "open";
  origin: Origin;
  revision: number;
  affectedClipIds: string[];
}

export type CommandResult =
  | { ok: true; revision: number; affectedClipIds: string[]; affectedMediaIds: string[]; project: Project }
  | { ok: false; code: string; message: string; currentRevision: number };

type Listener = (project: Project, change: Change) => void;

const contentOf = (p: Project): Content => ({ fps: p.fps, nextId: p.nextId, media: p.media, clips: p.clips });

/**
 * The canonical project store. Every edit, from the UI or from MCP, goes through
 * `execute`. One call == one transaction == one revision bump and one notification.
 */
export class ProjectStore {
  private project: Project;
  private undoStack: Content[] = [];
  private redoStack: Content[] = [];
  private listeners = new Set<Listener>();

  constructor(initial?: Project, newProjectId: () => string = () => crypto.randomUUID()) {
    this.project = initial ?? {
      formatVersion: FORMAT_VERSION,
      id: newProjectId(),
      name: "Untitled",
      revision: 0,
      ...emptyContent(),
    };
  }

  get state(): Project {
    return this.project;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  execute(raw: unknown, expectedRevision: unknown, origin: Origin = "ui"): CommandResult {
    try {
      if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision)) {
        throw new EditError("INVALID_ARGUMENT", "expectedRevision must be an integer");
      }
      const parsed = CommandSchema.safeParse(raw);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        throw new EditError("INVALID_ARGUMENT", `${i?.path.join(".") || "command"}: ${i?.message ?? "invalid"}`);
      }
      if (expectedRevision !== this.project.revision) {
        throw new EditError(
          "STALE_REVISION",
          `Expected revision ${expectedRevision} but the project is at ${this.project.revision}. Re-read the project state and retry.`,
        );
      }
      const cmd = parsed.data;
      const before = contentOf(this.project);
      let next: Content;
      let affectedClipIds: string[] = [];
      let affectedMediaIds: string[] = [];

      if (cmd.type === "undo" || cmd.type === "redo") {
        const from = cmd.type === "undo" ? this.undoStack : this.redoStack;
        const to = cmd.type === "undo" ? this.redoStack : this.undoStack;
        const snap = from[from.length - 1];
        if (!snap) {
          throw new EditError(cmd.type === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO", `Nothing to ${cmd.type}`);
        }
        affectedClipIds = diffClipIds(before, snap);
        next = snap;
        from.pop();
        to.push(before);
      } else {
        const applied = applyEdit(before, cmd);
        next = applied.content;
        affectedClipIds = applied.affectedClipIds;
        affectedMediaIds = applied.affectedMediaIds;
        this.undoStack.push(before);
        this.redoStack = [];
      }

      this.project = { ...this.project, ...next, revision: this.project.revision + 1 };
      this.emit({ kind: cmd.type, origin, revision: this.project.revision, affectedClipIds });
      return { ok: true, revision: this.project.revision, affectedClipIds, affectedMediaIds, project: this.project };
    } catch (e) {
      if (e instanceof EditError) {
        return { ok: false, code: e.code, message: e.message, currentRevision: this.project.revision };
      }
      throw e;
    }
  }

  /** Replace the whole project (open file). History is cleared; revision stays monotonic. */
  replace(next: Project, origin: Origin = "ui"): void {
    this.undoStack = [];
    this.redoStack = [];
    this.project = { ...next, revision: Math.max(next.revision, this.project.revision) + 1 };
    this.emit({ kind: "open", origin, revision: this.project.revision, affectedClipIds: next.clips.map((c) => c.id) });
  }

  private emit(change: Change): void {
    for (const fn of this.listeners) fn(this.project, change);
  }
}

function diffClipIds(a: Content, b: Content): string[] {
  const ids = new Set<string>();
  const byId = (c: Content) => new Map(c.clips.map((x) => [x.id, JSON.stringify(x)]));
  const ma = byId(a);
  const mb = byId(b);
  for (const [id, v] of ma) if (mb.get(id) !== v) ids.add(id);
  for (const [id, v] of mb) if (ma.get(id) !== v) ids.add(id);
  return [...ids];
}
