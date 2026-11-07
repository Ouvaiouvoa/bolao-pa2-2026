import {
  aspectOf,
  resolveColor,
  SAFE_ZONES,
  type BrandTokens,
  type Box,
  type ColorRef,
} from "@cmf/schemas";

/** Brand as a system: tokens → concrete values used by templates, renderer and checks. */

export interface FontFile {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Relative file name under the fonts base URL, or an absolute URL for brand-uploaded fonts. */
  src: string;
}

/** Fonts shipped with the product (SIL Open Font License — Inter by Rasmus Andersson). */
export const BUNDLED_FONTS: FontFile[] = [
  { family: "Inter", weight: 400, style: "normal", src: "inter-latin-400-normal.woff2" },
  { family: "Inter", weight: 600, style: "normal", src: "inter-latin-600-normal.woff2" },
  { family: "Inter", weight: 800, style: "normal", src: "inter-latin-800-normal.woff2" },
  { family: "Inter", weight: 900, style: "normal", src: "inter-latin-900-normal.woff2" },
];

export function fontsForBrand(tokens: BrandTokens, brandFonts: FontFile[] = []): FontFile[] {
  const wanted = new Set([tokens.typography.heading, tokens.typography.body, ...tokens.typography.extraApprovedFonts]);
  const all = [...BUNDLED_FONTS, ...brandFonts];
  return all.filter((f) => wanted.has(f.family));
}

/** Families required by the brand that have no font file available → render must fail explicitly. */
export function missingFontFamilies(tokens: BrandTokens, available: FontFile[]): string[] {
  const have = new Set(available.map((f) => f.family));
  return [tokens.typography.heading, tokens.typography.body].filter((f, i, arr) => arr.indexOf(f) === i && !have.has(f));
}

export function color(tokens: BrandTokens, ref: ColorRef): string {
  return resolveColor(ref, tokens);
}

/** WCAG relative luminance / contrast ratio (QA "contraste mínimo acessível"). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

/** Picks black or white text for a given background to guarantee contrast ≥ 4.5. */
export function readableOn(bg: string): "#FFFFFF" | "#111111" {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#111111") ? "#FFFFFF" : "#111111";
}

export interface SafeArea {
  top: number;
  bottom: number;
  side: number;
}

export function safeAreaFor(width: number, height: number): SafeArea {
  return SAFE_ZONES[aspectOf(width, height)];
}

/** Clamps a box (percent units) into the platform safe area. */
export function clampToSafe(box: Box, safe: SafeArea, opts: { allowFooter?: boolean } = {}): Box {
  const bottomLimit = opts.allowFooter ? 99 : 100 - safe.bottom;
  const w = Math.min(box.w, 100 - 2 * safe.side);
  const h = Math.min(box.h, bottomLimit - safe.top);
  const x = Math.min(Math.max(box.x, safe.side), 100 - safe.side - w);
  const y = Math.min(Math.max(box.y, safe.top), bottomLimit - h);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Logo box from brand tokens (safe area margin + minimum width). */
export function logoBox(tokens: BrandTokens, width: number, height: number): Box {
  const safe = safeAreaFor(width, height);
  const margin = Math.max(tokens.logo.safeAreaPercent, safe.side);
  const w = Math.max(tokens.logo.minWidthPercent, 14);
  const h = (w * width) / height / 2.4; // logos are typically ~2.4:1; real ratio applied by object-fit
  const pos = tokens.logo.position;
  const x = pos.endsWith("right") ? 100 - margin - w : margin;
  const y = pos.startsWith("top") ? Math.max(margin * (width / height), safe.top) : 100 - safe.bottom - h;
  return clampToSafe({ x, y, w, h }, safe);
}

/** Motion style → animation parameters used by Remotion components. */
export function motionProfile(style: BrandTokens["motion"]["style"]): { springDamping: number; springStiffness: number; stagger: number; intensity: "low" | "medium" | "high" } {
  switch (style) {
    case "energetic":
      return { springDamping: 11, springStiffness: 180, stagger: 2, intensity: "high" };
    case "minimal":
      return { springDamping: 30, springStiffness: 90, stagger: 4, intensity: "low" };
    case "corporate":
      return { springDamping: 22, springStiffness: 110, stagger: 3, intensity: "low" };
    case "clean-cinematic":
    default:
      return { springDamping: 18, springStiffness: 120, stagger: 3, intensity: "medium" };
  }
}
