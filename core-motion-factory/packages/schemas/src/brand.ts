import { z } from "zod";

export const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "cor deve estar no formato #RRGGBB ou #RRGGBBAA")
  .transform((v) => v.toUpperCase());

/** Semantic color names a template is allowed to reference. Raw hex in edit plans must map to one of these. */
export const BRAND_COLOR_ROLES = ["primary", "secondary", "accent", "success", "danger"] as const;
export const BrandColorRole = z.enum(BRAND_COLOR_ROLES);
export type BrandColorRole = z.infer<typeof BrandColorRole>;

export const BrandTokensSchema = z.strictObject({
  colors: z.strictObject({
    primary: HexColor,
    secondary: HexColor,
    accent: HexColor,
    success: HexColor,
    danger: HexColor,
  }),
  /** Additional colors explicitly allowed by the brand owner (e.g. campaign colors). */
  extraAllowedColors: z.array(HexColor).max(16).default([]),
  typography: z.strictObject({
    heading: z.string().min(1).max(64),
    body: z.string().min(1).max(64),
    captionWeight: z.number().int().min(100).max(900),
    /** Extra font families approved for this brand (beyond heading/body). */
    extraApprovedFonts: z.array(z.string().min(1).max(64)).max(8).default([]),
  }),
  logo: z.strictObject({
    defaultAssetId: z.string().nullable(),
    safeAreaPercent: z.number().min(0).max(20),
    minWidthPercent: z.number().min(4).max(50),
    position: z.enum(["top-left", "top-right", "bottom-right", "bottom-left"]).default("top-right"),
  }),
  captions: z.strictObject({
    maxLines: z.number().int().min(1).max(3),
    maxCharsPerLine: z.number().int().min(12).max(60),
    safeBottomPercent: z.number().min(5).max(40),
    highlightColor: HexColor,
    preset: z.enum(["bold-pop", "clean", "karaoke"]).default("bold-pop"),
  }),
  motion: z.strictObject({
    style: z.enum(["clean-cinematic", "energetic", "minimal", "corporate"]),
    transitionFrames: z.number().int().min(0).max(30),
    maxAnimationsPerScene: z.number().int().min(0).max(8),
  }),
  footer: z.strictObject({
    enabled: z.boolean(),
    text: z.string().max(80),
  }),
  audio: z
    .strictObject({
      targetLufs: z.number().min(-30).max(-8).default(-14),
      truePeakDb: z.number().min(-6).max(0).default(-1),
      musicVolume: z.number().min(0).max(1).default(0.18),
      duckedMusicVolume: z.number().min(0).max(1).default(0.06),
    })
    .default({ targetLufs: -14, truePeakDb: -1, musicVolume: 0.18, duckedMusicVolume: 0.06 }),
});
export type BrandTokens = z.infer<typeof BrandTokensSchema>;
export type BrandTokensInput = z.input<typeof BrandTokensSchema>;

export const ToneRulesSchema = z.strictObject({
  voice: z.string().max(400).default(""),
  /** Words that must never appear on screen or in generated copy. */
  forbiddenWords: z.array(z.string().min(1).max(60)).max(200).default([]),
  /** Preferred spellings: wrong → right. Used by QA (grafia). */
  preferredSpellings: z.record(z.string(), z.string()).default({}),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]+$/u)).max(30).default([]),
});
export type ToneRules = z.infer<typeof ToneRulesSchema>;

export const ComplianceRulesSchema = z.strictObject({
  sector: z.enum(["general", "health", "finance", "education", "food", "real_estate", "public_sector"]).default("general"),
  prohibitedTerms: z.array(z.string().min(1).max(80)).max(300).default([]),
  requiredDisclaimer: z.string().max(300).nullable().default(null),
  allowPersonalData: z.boolean().default(false),
  /** When true any high-severity compliance finding blocks the pipeline until a human decides. */
  blockOnHighSeverity: z.boolean().default(true),
});
export type ComplianceRules = z.infer<typeof ComplianceRulesSchema>;

export const DEFAULT_BRAND_TOKENS: BrandTokens = BrandTokensSchema.parse({
  colors: { primary: "#111111", secondary: "#F2F2F2", accent: "#FF5A1F", success: "#19C37D", danger: "#E53935" },
  typography: { heading: "Inter", body: "Inter", captionWeight: 800 },
  logo: { defaultAssetId: null, safeAreaPercent: 6, minWidthPercent: 12, position: "top-right" },
  captions: { maxLines: 2, maxCharsPerLine: 28, safeBottomPercent: 18, highlightColor: "#FF5A1F", preset: "bold-pop" },
  motion: { style: "clean-cinematic", transitionFrames: 8, maxAnimationsPerScene: 3 },
  footer: { enabled: true, text: "by HAXIS Core" },
});

export const DEFAULT_TONE_RULES: ToneRules = ToneRulesSchema.parse({});
export const DEFAULT_COMPLIANCE_RULES: ComplianceRules = ComplianceRulesSchema.parse({});

/** All colors a composition may legally use for this brand (uppercase hex). */
export function allowedBrandColors(tokens: BrandTokens): Set<string> {
  const set = new Set<string>(Object.values(tokens.colors));
  for (const c of tokens.extraAllowedColors) set.add(c);
  set.add(tokens.captions.highlightColor);
  // Pure black/white are always allowed as neutral text/scrims.
  set.add("#000000");
  set.add("#FFFFFF");
  return set;
}

export function approvedBrandFonts(tokens: BrandTokens): Set<string> {
  return new Set([tokens.typography.heading, tokens.typography.body, ...tokens.typography.extraApprovedFonts]);
}
