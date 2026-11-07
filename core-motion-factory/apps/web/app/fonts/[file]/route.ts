import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const FONTS = path.resolve(process.cwd(), "../../packages/remotion/public/fonts");

/** Serves the bundled OFL fonts so the browser Player matches the renderer exactly. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!/^[a-z0-9-]+\.woff2$/.test(file)) return new Response("not found", { status: 404 });
  try {
    const data = await readFile(path.join(FONTS, file));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
