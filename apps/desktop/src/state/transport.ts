import type { CommandResult, Snapshot } from "@lumiere-pro/core";

export interface ApiResult {
  ok: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

export interface Transport {
  /** Streams snapshots (initial + one per committed transaction). Returns an unsubscribe fn. */
  subscribe(onSnapshot: (s: Snapshot) => void, onStatus: (connected: boolean) => void): () => void;
  command(command: unknown, expectedRevision: number): Promise<CommandResult>;
  post(path: string, body: unknown): Promise<ApiResult>;
  /** Read-only token for <video src> URLs (which cannot send headers). */
  mediaToken(): Promise<string>;
}

/**
 * HTTP + Server-Sent-Events transport to the editor host. In the browser the Vite
 * proxy adds the auth header; in tests pass `headers` explicitly. SSE is parsed by
 * hand over fetch so it works identically in the browser and in Node.
 */
export function httpTransport(baseUrl = "", headers: Record<string, string> = {}): Transport {
  const req = async (path: string, init?: RequestInit) => {
    const res = await fetch(baseUrl + path, { ...init, headers: { "content-type": "application/json", ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  };
  return {
    subscribe(onSnapshot, onStatus) {
      const ctl = new AbortController();
      let stopped = false;
      const run = async () => {
        let delay = 250;
        while (!stopped) {
          try {
            const res = await fetch(baseUrl + "/api/events", { headers, signal: ctl.signal });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            onStatus(true);
            delay = 250;
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buf = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += value;
              let i: number;
              while ((i = buf.indexOf("\n\n")) >= 0) {
                const frame = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const data = frame
                  .split("\n")
                  .filter((l) => l.startsWith("data: "))
                  .map((l) => l.slice(6))
                  .join("");
                if (data) onSnapshot(JSON.parse(data) as Snapshot);
              }
            }
          } catch {
            /* fall through to reconnect */
          }
          if (stopped) return;
          onStatus(false);
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 3000);
        }
      };
      void run();
      return () => {
        stopped = true;
        ctl.abort();
      };
    },
    async command(command, expectedRevision) {
      const res = await req("/api/command", {
        method: "POST",
        body: JSON.stringify({ command, expectedRevision, origin: "ui" }),
      });
      return (await res.json()) as CommandResult;
    },
    async mediaToken() {
      const res = await req("/api/session");
      return ((await res.json()) as { mediaToken: string }).mediaToken;
    },
    async post(path, body) {
      const res = await req(path, { method: "POST", body: JSON.stringify(body) });
      return (await res.json()) as ApiResult;
    },
  };
}
