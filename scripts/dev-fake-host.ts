// Dev-only: runs the real host with a stubbed probe so the UI can be exercised
// without FFmpeg installed. The "video" is a placeholder file, so preview shows black.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../packages/host/src";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ce-fake-"));
const media = path.join(dir, "demo.mp4");
await fs.writeFile(media, "placeholder");
console.error(`placeholder media: ${media}`);

await startHost({
  port: Number(process.env.CE_PORT ?? 47821),
  probe: async (real) => ({
    path: real,
    name: path.basename(real),
    durationSec: 10,
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    hasVideo: true,
    audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000 }],
  }),
});
