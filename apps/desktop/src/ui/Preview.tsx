import { useEffect, useRef } from "react";
import { timelineDuration } from "@lumiere-pro/core";
import { clipAt } from "../state/layout";
import { editor, useEditor } from "./storeContext";

/** Timeline-driven preview: the playhead is the clock, the <video> follows it. */
export function Preview() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const mediaToken = useEditor((s) => s.mediaToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<string | null>(null);

  const active = project ? clipAt(project, playhead) : null;
  const media = active && project ? (project.media.find((m) => m.id === active.mediaId) ?? null) : null;

  // Point the <video> at the right source and frame for the current playhead.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !project) return;
    if (!active || !media || !mediaToken) {
      v.pause();
      return;
    }
    if (mediaRef.current !== media.id) {
      mediaRef.current = media.id;
      v.src = `/media/${encodeURIComponent(media.id)}?t=${mediaToken}`;
    }
    const want = ((active.inFrame + (playhead - active.startFrame)) * project.fps.den) / project.fps.num;
    if (!playing || Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [project, active, media, mediaToken, playhead, playing]);

  // Playback clock.
  useEffect(() => {
    if (!playing || !project) return;
    const fps = project.fps.num / project.fps.den;
    const t0 = performance.now();
    const p0 = editor.getState().playhead;
    let raf = 0;
    const tick = () => {
      const st = editor.getState();
      const p = st.project;
      if (!p) return;
      const frame = p0 + Math.floor(((performance.now() - t0) / 1000) * fps);
      if (frame >= timelineDuration(p.clips)) {
        st.setPlaying(false);
        st.setPlayhead(timelineDuration(p.clips));
        return;
      }
      st.setPlayhead(frame);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project?.fps.num, project?.fps.den]);

  const hasClips = (project?.clips.length ?? 0) > 0;
  return (
    <div className="preview">
      <div className="screen">
        <video ref={videoRef} muted={false} playsInline preload="auto" style={{ visibility: active ? "visible" : "hidden" }} />
        {!project && <div className="overlay">Waiting for the editor host…</div>}
        {project && !hasClips && <div className="overlay">Import a video to begin (enter its absolute path above).</div>}
        {project && hasClips && !active && <div className="overlay">Gap — no clip at this frame</div>}
      </div>
      <div className="transport">
        <button
          disabled={!hasClips}
          onClick={() => {
            const st = editor.getState();
            if (!st.playing && project && st.playhead >= timelineDuration(project.clips)) st.setPlayhead(0);
            st.setPlaying(!st.playing);
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        {media && (
          <span className="muted">
            {media.name} · {media.width}×{media.height} · {(media.fps.num / media.fps.den).toFixed(2)} fps ·{" "}
            {media.audioStreams.length} audio stream{media.audioStreams.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
