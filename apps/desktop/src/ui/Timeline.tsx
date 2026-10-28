import { useEffect, useMemo, useRef, useState } from "react";
import { timelineDuration } from "@lumiere-pro/core";
import { selectTimelineLayout } from "../state/layout";
import { editor, useEditor } from "./storeContext";

const MIN_SECONDS = 20;

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const selected = useEditor((s) => s.selectedClipId);
  const lastChange = useEditor((s) => s.lastChange);
  const boxes = useMemo(() => selectTimelineLayout(project, zoom), [project, zoom]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; startX: number; origin: number; delta: number } | null>(null);
  const [flash, setFlash] = useState<string[]>([]);

  // Briefly highlight clips touched by the last transaction (especially Claude's).
  useEffect(() => {
    if (!lastChange) return;
    setFlash(lastChange.affectedClipIds);
    const t = setTimeout(() => setFlash([]), 1200);
    return () => clearTimeout(t);
  }, [lastChange]);

  if (!project) return <div className="timeline empty">Waiting for the editor host…</div>;
  const fps = project.fps;
  const fpsRounded = Math.max(1, Math.round(fps.num / fps.den));
  const totalFrames = Math.max(timelineDuration(project.clips) + fpsRounded * 5, fpsRounded * MIN_SECONDS);
  const width = totalFrames * zoom;
  const tickEvery = Math.max(1, Math.ceil(60 / (fpsRounded * zoom))) * fpsRounded;
  const ticks = Array.from({ length: Math.floor(totalFrames / tickEvery) + 1 }, (_, i) => i * tickEvery);

  const frameAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - r.left) / zoom));
  };

  return (
    <div className="timeline">
      <div className="scroll">
        <div className="canvas" style={{ width }}>
          <div className="ruler" onPointerDown={(e) => editor.getState().setPlayhead(frameAt(e.clientX))}>
            {ticks.map((f) => (
              <span key={f} className="tick" style={{ left: f * zoom }}>
                {Math.round(f / fpsRounded)}s
              </span>
            ))}
          </div>
          <div
            className="track"
            ref={trackRef}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                editor.getState().select(null);
                editor.getState().setPlayhead(frameAt(e.clientX));
              }
            }}
          >
            {boxes.map((b) => {
              const dragging = drag?.id === b.id;
              const left = dragging ? Math.max(0, b.left + drag.delta * zoom) : b.left;
              return (
                <div
                  key={b.id}
                  data-clip-id={b.id}
                  className={`clip${selected === b.id ? " selected" : ""}${flash.includes(b.id) ? " flash" : ""}`}
                  style={{ left, width: b.width }}
                  title={`${b.id}: frames ${b.startFrame}–${b.endFrame}`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    editor.getState().select(b.id);
                    setDrag({ id: b.id, startX: e.clientX, origin: b.startFrame, delta: 0 });
                  }}
                  onPointerMove={(e) => {
                    if (drag?.id === b.id) setDrag({ ...drag, delta: Math.round((e.clientX - drag.startX) / zoom) });
                  }}
                  onPointerUp={() => {
                    if (drag?.id !== b.id) return;
                    const target = Math.max(0, drag.origin + drag.delta);
                    setDrag(null);
                    if (target !== drag.origin) {
                      void editor.getState().run({ type: "move_clip", clipId: b.id, startFrame: target });
                    }
                  }}
                  onPointerCancel={() => setDrag(null)}
                >
                  <span className="clip-label">{b.label}</span>
                  <span className="clip-id">{b.id}</span>
                </div>
              );
            })}
          </div>
          <div className="playhead" style={{ left: playhead * zoom }} />
        </div>
      </div>
    </div>
  );
}
