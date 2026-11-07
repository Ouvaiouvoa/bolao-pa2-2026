import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { BUNDLED_FONTS } from "@cmf/brand-engine";
import { startTimer } from "@cmf/observability";
import type { CompositionProps, RenderFont, RenderMediaRef } from "@cmf/remotion";
import type { BrandTokens, EditPlan } from "@cmf/schemas";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FONTS_DIR, getBundle } from "./bundle";
import { startMediaServer } from "./media-server";

export const COMPOSITION_ID = "CmfEditPlan";

export interface LocalMedia {
  /** Local file path of the media (proxy for preview, mezzanine for master). */
  path: string;
  kind: RenderMediaRef["kind"];
}

export interface RenderRequest {
  plan: EditPlan;
  brand: { name: string; tokens: BrandTokens };
  media: Record<string, LocalMedia>;
  /** Extra brand font files (family, weight, local path). */
  brandFonts?: { family: string; weight: number; style: "normal" | "italic"; path: string }[];
  output: string;
  /** 1 = full resolution; 0.5 = preview. */
  scale: number;
  crf?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Chrome used by Remotion. Explicit CMF_CHROME_EXECUTABLE wins; otherwise a locally installed
 * headless shell is auto-detected. Only when nothing is found does Remotion download its own
 * (requires network access to Remotion's CDN).
 */
export function chromeExecutable(): string | null {
  const p = process.env.CMF_CHROME_EXECUTABLE;
  if (p && p.trim()) return p.trim();
  for (const base of ["/opt/pw-browsers", path.join(os.homedir(), ".cache/ms-playwright")]) {
    try {
      for (const dir of readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()) {
        const candidate = path.join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      /* not installed here */
    }
  }
  return null;
}

async function prepare(req: Pick<RenderRequest, "plan" | "brand" | "media" | "brandFonts">) {
  const server = await startMediaServer();
  const media: Record<string, RenderMediaRef> = {};
  for (const [id, m] of Object.entries(req.media)) media[id] = { src: server.add(`media-${id}${path.extname(m.path)}`, m.path), kind: m.kind };
  const fonts: RenderFont[] = BUNDLED_FONTS.map((f) => ({ family: f.family, weight: f.weight, style: f.style, url: server.add(`fonts/${f.src}`, path.join(FONTS_DIR, f.src)) }));
  for (const f of req.brandFonts ?? []) fonts.push({ family: f.family, weight: f.weight, style: f.style, url: server.add(`brandfonts/${path.basename(f.path)}`, f.path) });
  const inputProps: CompositionProps = { plan: req.plan, brand: req.brand, media, fonts };
  return { server, inputProps };
}

/** Renders an edit plan to H.264/AAC MP4 with Remotion. Deterministic per frame. */
export async function renderEditPlan(req: RenderRequest): Promise<{ framesRendered: number; renderMs: number }> {
  const timer = startTimer();
  const serveUrl = await getBundle();
  const { server, inputProps } = await prepare(req);
  try {
    const browserExecutable = chromeExecutable();
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, browserExecutable, logLevel: "error" });
    let frames = 0;
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: req.output,
      scale: req.scale,
      crf: req.crf ?? (req.scale < 1 ? 28 : 18),
      x264Preset: req.scale < 1 ? "veryfast" : "medium",
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: req.scale < 1 ? 80 : 92,
      concurrency: Number(process.env.CMF_RENDER_CONCURRENCY ?? 2),
      browserExecutable,
      chromiumOptions: { gl: "swangle" },
      enforceAudioTrack: true,
      overwrite: true,
      logLevel: "error",
      timeoutInMilliseconds: 120_000,
      licenseKey: process.env.REMOTION_LICENSE_KEY ?? null,
      onProgress: ({ progress, renderedFrames }) => {
        frames = renderedFrames;
        req.onProgress?.(progress);
      },
    });
    return { framesRendered: frames || composition.durationInFrames, renderMs: timer() };
  } finally {
    await server.close();
  }
}

/** Renders a single frame (thumbnails/capas and visual reference tests). */
export async function renderFrame(req: Omit<RenderRequest, "scale" | "onProgress" | "crf"> & { frame: number; scale?: number }): Promise<void> {
  const serveUrl = await getBundle();
  const { server, inputProps } = await prepare(req);
  try {
    const browserExecutable = chromeExecutable();
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, browserExecutable, logLevel: "error" });
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      frame: req.frame,
      output: req.output,
      imageFormat: req.output.endsWith(".png") ? "png" : "jpeg",
      scale: req.scale ?? 1,
      browserExecutable,
      chromiumOptions: { gl: "swangle" },
      overwrite: true,
      logLevel: "error",
      licenseKey: process.env.REMOTION_LICENSE_KEY ?? null,
    });
  } finally {
    await server.close();
  }
}
