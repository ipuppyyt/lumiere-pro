import type { Change } from "./store";
import type { Project } from "./model";

/** What the host pushes to every subscriber (SSE) after each committed transaction. */
export interface Snapshot {
  project: Project;
  /** The transaction that produced this snapshot; null for the initial snapshot on connect. */
  change: Change | null;
  canUndo: boolean;
  canRedo: boolean;
}

/** Info the MCP server and dev tooling use to find the running editor host. */
export interface HostInfo {
  port: number;
  token: string;
  pid: number;
}
