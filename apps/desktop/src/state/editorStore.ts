import { createStore, type StoreApi } from "zustand/vanilla";
import {
  clipEnd,
  timelineDuration,
  type Change,
  type Command,
  type Project,
  type Snapshot,
} from "@lumiere-pro/core";
import type { Transport } from "./transport";

export interface EditorState {
  connected: boolean;
  /** Query-string credential for /media URLs; null until fetched. */
  mediaToken: string | null;
  project: Project | null;
  canUndo: boolean;
  canRedo: boolean;
  /** The last transaction applied, whoever made it. Drives highlights. */
  lastChange: Change | null;
  /** Count of snapshots received; lets tests/UI observe redraws. */
  snapshotCount: number;
  error: string | null;
  // UI-only state (never part of the project):
  playhead: number;
  playing: boolean;
  selectedClipId: string | null;
  zoom: number; // pixels per frame
}

export interface EditorActions {
  start(): () => void;
  /** Every manual edit funnels through here -> host command service. */
  run(command: Command): Promise<boolean>;
  importMedia(path: string): Promise<boolean>;
  saveProject(path: string): Promise<boolean>;
  openProject(path: string): Promise<boolean>;
  setPlayhead(frame: number): void;
  setPlaying(playing: boolean): void;
  select(id: string | null): void;
  setZoom(z: number): void;
  clearError(): void;
}

export type EditorStore = StoreApi<EditorState & EditorActions>;

export function createEditorStore(transport: Transport): EditorStore {
  return createStore<EditorState & EditorActions>((set, get) => {
    const fail = (message: string) => {
      set({ error: message });
      return false;
    };
    return {
      connected: false,
      mediaToken: null,
      project: null,
      canUndo: false,
      canRedo: false,
      lastChange: null,
      snapshotCount: 0,
      error: null,
      playhead: 0,
      playing: false,
      selectedClipId: null,
      zoom: 4,

      start() {
        return transport.subscribe(
          (s: Snapshot) =>
            set((st) => {
              const end = timelineDuration(s.project.clips);
              const sel = s.project.clips.some((c) => c.id === st.selectedClipId) ? st.selectedClipId : null;
              return {
                project: s.project,
                canUndo: s.canUndo,
                canRedo: s.canRedo,
                lastChange: s.change ?? st.lastChange,
                snapshotCount: st.snapshotCount + 1,
                selectedClipId: sel,
                playhead: Math.min(st.playhead, end),
              };
            }),
          (connected) => {
            set({ connected });
            if (connected) void transport.mediaToken().then((mediaToken) => set({ mediaToken }), () => {});
          },
        );
      },

      async run(command) {
        const project = get().project;
        if (!project) return fail("Not connected to the editor host");
        try {
          const r = await transport.command(command, project.revision);
          if (!r.ok) return fail(`${r.code}: ${r.message}`);
          set({ error: null });
          return true;
        } catch (e) {
          return fail(`Host unreachable: ${(e as Error).message}`);
        }
      },

      async importMedia(path) {
        const project = get().project;
        if (!project) return fail("Not connected to the editor host");
        try {
          const r = await transport.post("/api/media/import", { path, expectedRevision: project.revision, origin: "ui" });
          if (!r.ok) return fail(`${r.code}: ${r.message}`);
          set({ error: null });
          return true;
        } catch (e) {
          return fail(`Host unreachable: ${(e as Error).message}`);
        }
      },

      async saveProject(path) {
        try {
          const r = await transport.post("/api/project/save", { path });
          return r.ok ? (set({ error: null }), true) : fail(`${r.code}: ${r.message}`);
        } catch (e) {
          return fail(`Host unreachable: ${(e as Error).message}`);
        }
      },

      async openProject(path) {
        try {
          const r = await transport.post("/api/project/open", { path });
          if (!r.ok) return fail(`${r.code}: ${r.message}`);
          const missing = (r.missingMedia as string[] | undefined) ?? [];
          set({ error: missing.length ? `Opened, but source media is missing: ${missing.join(", ")}` : null });
          return true;
        } catch (e) {
          return fail(`Host unreachable: ${(e as Error).message}`);
        }
      },

      setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),
      setPlaying: (playing) => set({ playing }),
      select: (id) => set({ selectedClipId: id }),
      setZoom: (z) => set({ zoom: Math.min(40, Math.max(0.25, z)) }),
      clearError: () => set({ error: null }),
    };
  });
}

export { clipEnd };
