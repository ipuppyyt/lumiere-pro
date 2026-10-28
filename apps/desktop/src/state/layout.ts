import { clipEnd, sortedClips, type Project } from "@lumiere-pro/core";

export interface ClipBox {
  id: string;
  label: string;
  left: number;
  width: number;
  startFrame: number;
  endFrame: number;
}

/** Pure projection of the project onto timeline pixels; the Timeline component renders exactly this. */
export function selectTimelineLayout(project: Project | null, zoom: number): ClipBox[] {
  if (!project) return [];
  return sortedClips(project.clips).map((c) => ({
    id: c.id,
    label: project.media.find((m) => m.id === c.mediaId)?.name ?? c.mediaId,
    left: c.startFrame * zoom,
    width: c.durationFrames * zoom,
    startFrame: c.startFrame,
    endFrame: clipEnd(c),
  }));
}

export function clipAt(project: Project, frame: number) {
  return project.clips.find((c) => frame >= c.startFrame && frame < clipEnd(c)) ?? null;
}

export function timecode(frame: number, fps: { num: number; den: number }): string {
  const secs = (frame * fps.den) / fps.num;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const f = frame - Math.round((Math.floor(secs) * fps.num) / fps.den);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(Math.max(0, f)).padStart(2, "0")}`;
}
