import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getStorage, LocalObjectStorage, organizationOfKey } from "@cmf/storage";
import { currentUser } from "@/lib/server/auth";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4", wav: "audio/wav", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", json: "application/json", srt: "application/x-subrip", vtt: "text/vtt", zip: "application/zip", txt: "text/plain; charset=utf-8", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };

/**
 * Serves local-driver objects through short-lived signed URLs, with Range support for video
 * seeking. Defense in depth: the signature AND the caller's organization must match the key.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const storage = getStorage();
  if (!(storage instanceof LocalObjectStorage)) return new Response("not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const dn = url.searchParams.get("dn") ?? undefined;
  if (!storage.verifySignedUrl(key, exp, url.searchParams.get("sig") ?? "", dn)) return new Response("assinatura inválida ou expirada", { status: 403 });
  const user = await currentUser();
  if (!user || organizationOfKey(key) !== user.organizationId) return new Response("forbidden", { status: 403 });
  const st = await storage.stat(key);
  if (!st) return new Response("not found", { status: 404 });
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const headers: Record<string, string> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=600",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (dn) headers["Content-Disposition"] = `attachment; filename="${dn.replace(/[^\w.-]/g, "_")}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
    const stream = await storage.openRead(key, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = await storage.openRead(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...headers, "Content-Length": String(st.size) } });
}
