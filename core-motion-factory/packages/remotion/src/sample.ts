import { staticFile } from "remotion";
import { BUNDLED_FONTS } from "@cmf/brand-engine";
import { DEFAULT_BRAND_TOKENS, type EditPlan } from "@cmf/schemas";
import type { CompositionProps } from "./types";

/**
 * Studio/visual-test sample: the premium authority template without source footage
 * (motion, captions and brand only). Real renders always receive a validated edit plan.
 */
export function sampleEditPlan(width = 1080, height = 1920): EditPlan {
  const fps = 30;
  const vertical = height > width;
  const square = width === height;
  const hookBox = vertical ? { x: 8, y: 16, w: 84, h: 20 } : square ? { x: 7, y: 9, w: 86, h: 22 } : { x: 6, y: 10, w: 60, h: 26 };
  const ltBox = vertical ? { x: 8, y: 58, w: 70, h: 9 } : square ? { x: 7, y: 60, w: 60, h: 11 } : { x: 6, y: 66, w: 40, h: 13 };
  const ctaBox = vertical ? { x: 8, y: 30, w: 84, h: 36 } : square ? { x: 7, y: 22, w: 86, h: 46 } : { x: 20, y: 22, w: 60, h: 50 };
  const calloutBox = vertical ? { x: 8, y: 12, w: 84, h: 8 } : square ? { x: 7, y: 8, w: 86, h: 10 } : { x: 6, y: 8, w: 50, h: 12 };
  const footerBox = vertical ? { x: 30, y: 95.2, w: 40, h: 2.6 } : square ? { x: 30, y: 95, w: 40, h: 3 } : { x: 38, y: 95, w: 24, h: 3.2 };
  const progressBox = vertical ? { x: 6, y: 8, w: 88, h: 0.6 } : square ? { x: 5, y: 5, w: 90, h: 0.8 } : { x: 5, y: 5, w: 90, h: 1 };
  const capBottom = vertical ? 22 : 12;
  const words = (text: string, from: number, step: number, hl: number | null) =>
    text.split(" ").map((w, i) => ({ text: w, startFrame: from + i * step, endFrame: from + i * step + step, highlight: hl === i }));
  return {
    schemaVersion: "1.0",
    projectId: "prj_sample",
    composition: { width, height, fps, durationInFrames: 300, backgroundColor: "#1D3557" },
    tracks: [
      { id: "video-main", type: "video", locked: false, muted: false, items: [] },
      {
        id: "captions-main",
        type: "captions",
        locked: false,
        muted: false,
        items: [
          { id: "cap-0001", fromFrame: 90, durationInFrames: 45, lines: ["Três em cada quatro", "pessoas abandonam"], words: words("Três em cada quatro pessoas abandonam", 90, 7, 0), preset: "bold-pop", bottomPercent: capBottom, color: "#FFFFFF", highlightColor: "accent", fontFamily: "Inter" },
          { id: "cap-0002", fromFrame: 135, durationInFrames: 45, lines: ["um vídeo nos", "primeiros segundos?"], words: words("um vídeo nos primeiros segundos?", 135, 8, null), preset: "bold-pop", bottomPercent: capBottom, color: "#FFFFFF", highlightColor: "accent", fontFamily: "Inter" },
        ],
      },
      {
        id: "motion-main",
        type: "motion",
        locked: false,
        muted: false,
        items: [
          { id: "mo-hook", kind: "hook_title", fromFrame: 0, durationInFrames: 84, box: hookBox, text: "Você sabia que 3 em cada 4 pessoas abandonam?", emphasis: ["3", "4"], color: "#FFFFFF", accentColor: "accent", fontFamily: "Inter" },
          { id: "mo-lower-third", kind: "lower_third", fromFrame: 96, durationInFrames: 90, box: ltBox, name: "Ana Souza", role: "Estrategista de conteúdo", color: "primary", accentColor: "accent", fontFamily: "Inter" },
          { id: "mo-callout-1", kind: "callout", fromFrame: 190, durationInFrames: 50, box: calloutBox, text: "1. Comece com um gancho", color: "accent", fontFamily: "Inter" },
          { id: "mo-progress", kind: "progress_bar", fromFrame: 0, durationInFrames: 240, box: progressBox, color: "accent" },
          { id: "mo-cta", kind: "cta", fromFrame: 240, durationInFrames: 60, box: ctaBox, headline: "Comente ROTEIRO", subline: "e receba o modelo", color: "accent", showLogo: false, fontFamily: "Inter" },
          { id: "mo-footer", kind: "footer", fromFrame: 0, durationInFrames: 300, box: footerBox, text: "by HAXIS Core", color: "#FFFFFF", fontFamily: "Inter" },
        ],
      },
      { id: "audio-main", type: "audio", locked: false, muted: false, items: [] },
    ],
    brandId: "brand_sample",
    templateId: "tpl_authority_001",
    metadata: { createdBy: "sample", createdAt: "2026-11-07T00:00:00.000Z", basedOnVersion: null, notes: "" },
  };
}

export function sampleFonts(baseUrl?: string) {
  return BUNDLED_FONTS.map((f) => ({ family: f.family, weight: f.weight, style: f.style, url: baseUrl ? `${baseUrl.replace(/\/$/, "")}/${f.src}` : staticFile(`fonts/${f.src}`) }));
}

export function getSampleProps(): CompositionProps {
  return { plan: sampleEditPlan(), brand: { name: "HAXIS Core", tokens: DEFAULT_BRAND_TOKENS }, media: {}, fonts: sampleFonts() };
}
