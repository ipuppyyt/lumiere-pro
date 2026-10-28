import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { APP_VERSION } from "@lumiere-pro/core";
import { timecode } from "../state/layout";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import { editor, useEditor } from "./storeContext";

const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function App() {
  useEffect(() => editor.getState().start(), []);

  const connected = useEditor((s) => s.connected);
  const project = useEditor((s) => s.project);
  const error = useEditor((s) => s.error);
  const lastChange = useEditor((s) => s.lastChange);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const selected = useEditor((s) => s.selectedClipId);
  const playhead = useEditor((s) => s.playhead);
  const [mediaPath, setMediaPath] = useState("");
  const [projectPath, setProjectPath] = useState("");

  const s = editor.getState();
  const sel = project?.clips.find((c) => c.id === selected) ?? null;
  const atSplit = sel && playhead > sel.startFrame && playhead < sel.startFrame + sel.durationFrames;

  return (
    <div className="app">
      <header>
        <strong>Lumiere Pro</strong>
        <span className="muted" title="Application version">v{APP_VERSION}</span>
        <span className={connected ? "pill ok" : "pill bad"}>{connected ? "host connected" : "host offline"}</span>
        {project && <span className="muted">rev {project.revision}</span>}
        {lastChange && lastChange.origin === "claude" && (
          <span className="pill claude">Claude: {lastChange.kind.replace("_", " ")}</span>
        )}
        <span className="spacer" />
        {native && (
          <button
            onClick={() =>
              void invoke<string | null>("pick_media_file").then((p) => (p ? s.importMedia(p) : undefined))
            }
          >
            Import video…
          </button>
        )}
        <input placeholder="C:\path\to\video.mp4" value={mediaPath} onChange={(e) => setMediaPath(e.target.value)} />
        <button disabled={!mediaPath} onClick={() => void s.importMedia(mediaPath).then((ok) => ok && setMediaPath(""))}>
          Import
        </button>
        <input
          placeholder="C:\path\to\project.lumiere.json"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
        />
        {native && (
          <>
            <button
              onClick={() =>
                void invoke<string | null>("pick_project_file", { save: true }).then((p) => (p ? s.saveProject(p) : undefined))
              }
            >
              Save as…
            </button>
            <button
              onClick={() =>
                void invoke<string | null>("pick_project_file", { save: false }).then((p) => (p ? s.openProject(p) : undefined))
              }
            >
              Open…
            </button>
          </>
        )}
        <button disabled={!projectPath} onClick={() => void s.saveProject(projectPath)}>Save</button>
        <button disabled={!projectPath} onClick={() => void s.openProject(projectPath)}>Open path</button>
      </header>
      {error && (
        <div className="error" role="alert">
          {error} <button onClick={() => s.clearError()}>dismiss</button>
        </div>
      )}
      <Preview />
      <div className="toolbar">
        <button disabled={!canUndo} onClick={() => void s.run({ type: "undo" })}>Undo</button>
        <button disabled={!canRedo} onClick={() => void s.run({ type: "redo" })}>Redo</button>
        <span className="sep" />
        <button
          disabled={!atSplit}
          title="Split the selected clip at the playhead"
          onClick={() => sel && void s.run({ type: "split_clip", clipId: sel.id, atFrame: playhead })}
        >
          Split
        </button>
        <button
          disabled={!sel || playhead >= sel.startFrame + sel.durationFrames}
          title="Trim the selected clip's start to the playhead"
          onClick={() => sel && void s.run({ type: "trim_clip", clipId: sel.id, side: "start", toFrame: playhead })}
        >
          Trim start
        </button>
        <button
          disabled={!sel || playhead <= sel.startFrame}
          title="Trim the selected clip's end to the playhead"
          onClick={() => sel && void s.run({ type: "trim_clip", clipId: sel.id, side: "end", toFrame: playhead })}
        >
          Trim end
        </button>
        <button disabled={!sel} onClick={() => sel && void s.run({ type: "remove_clip", clipId: sel.id })}>Delete</button>
        <span className="sep" />
        <button onClick={() => s.setZoom(s.zoom / 1.5)}>−</button>
        <button onClick={() => s.setZoom(s.zoom * 1.5)}>+</button>
        {project && <span className="muted mono">{timecode(playhead, project.fps)} · frame {playhead}</span>}
      </div>
      <Timeline />
    </div>
  );
}
