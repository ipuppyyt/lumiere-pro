import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { startHost } from "./server";

// Fixed dev port so the Vite proxy can find us; the token is read from host.json per request.
const port = Number(process.env.CE_PORT ?? 47821);
// Packaged app passes the bundled UI via CE_UI_DIR; in the repo we fall back to apps/desktop/dist.
const repoUi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/dist");
const uiDir = process.env.CE_UI_DIR ?? repoUi;

const host = await startHost({ port, uiDir: existsSync(uiDir) ? uiDir : undefined });

const stop = () => void host.close().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
