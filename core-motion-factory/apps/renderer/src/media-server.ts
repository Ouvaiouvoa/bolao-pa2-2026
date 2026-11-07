import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { randomToken } from "@cmf/schemas";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface MediaServer {
  /** Registers a local file and returns the URL Chrome will fetch it from. */
  add(name: string, localPath: string): string;
  close(): Promise<void>;
}

/**
 * Ephemeral loopback HTTP server used during a render: Chrome/Remotion fetch media by URL.
 * Only registered files are served, under an unguessable per-render token, with Range support.
 */
export async function startMediaServer(): Promise<MediaServer> {
  const token = randomToken(24);
  const files = new Map<string, string>();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const [, tok, ...rest] = url.pathname.split("/");
      const name = decodeURIComponent(rest.join("/"));
      const file = tok === token ? files.get(name) : undefined;
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const st = await stat(file);
      const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      const headers: Record<string, string | number> = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size) {
          res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
          return;
        }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
        if (req.method === "HEAD") return void res.end();
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, "Content-Length": st.size });
        if (req.method === "HEAD") return void res.end();
        createReadStream(file).pipe(res);
      }
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    add(name, localPath) {
      files.set(name, localPath);
      return `http://127.0.0.1:${port}/${token}/${encodeURIComponent(name)}`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
