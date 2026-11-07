import { z } from "zod";
import { BrandColorRole, HexColor } from "./brand";

/**
 * edit_plan.json — the single source of truth of a composition (section 12).
 * Every object is strict: unknown properties fail validation.
 */

export const EDIT_PLAN_SCHEMA_VERSION = "1.0" as const;

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_\-:.]+$/, "id inválido");
const Frame = z.number().int().min(0);
const PositiveFrames = z.number().int().min(1, "duração deve ser maior que zero");

/** A color reference is either a semantic brand role or an explicit hex value. */
export const ColorRef = z.union([BrandColorRole, HexColor]);
export type ColorRef = z.infer<typeof ColorRef>;

/** Box in percent of the composition (0–100). */
export const BoxSchema = z.strictObject({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().gt(0).max(100),
  h: z.number().gt(0).max(100),
});
export type Box = z.infer<typeof BoxSchema>;

export const TransformSchema = z.strictObject({
  /** Offset in percent of frame width/height. */
  x: z.number().min(-50).max(50).default(0),
  y: z.number().min(-50).max(50).default(0),
  scale: z.number().min(0.5).max(3).default(1),
  rotation: z.number().min(-45).max(45).default(0),
});

export const VideoItemSchema = z.strictObject({
  id: Id,
  assetId: Id,
  fromFrame: Frame,
  durationInFrames: PositiveFrames,
  sourceStartMs: z.number().min(0),
  sourceEndMs: z.number().min(0),
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Subject focus used for reframing (0..1 of the source frame). */
  focus: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
  transform: TransformSchema.default({ x: 0, y: 0, scale: 1, rotation: 0 }),
  /** Linear gain applied to the clip's own audio. 0 = mute, 1 = unity, max 2 (≈ +6 dB). */
  volume: z.number().min(0).max(2).default(1),
  label: z.string().max(120).optional(),
  /** Reference to the script beat that originated the clip (traceability). */
  beatId: z.string().max(64).optional(),
});
export type VideoItem = z.infer<typeof VideoItemSchema>;

export const CaptionWordSchema = z.strictObject({
  text: z.string().min(1).max(60),
  startFrame: Frame,
  endFrame: Frame,
  highlight: z.boolean().default(false),
});
export type CaptionWord = z.infer<typeof CaptionWordSchema>;

export const CaptionItemSchema = z.strictObject({
  id: Id,
  fromFrame: Frame,
  durationInFrames: PositiveFrames,
  lines: z.array(z.string().min(1).max(80)).min(1).max(3),
  words: z.array(CaptionWordSchema).min(1).max(40),
  preset: z.enum(["bold-pop", "clean", "karaoke"]).default("bold-pop"),
  /** Distance from the bottom edge in percent. */
  bottomPercent: z.number().min(0).max(80),
  color: ColorRef.default("#FFFFFF"),
  highlightColor: ColorRef.default("accent"),
  fontFamily: z.string().max(64).optional(),
});
export type CaptionItem = z.infer<typeof CaptionItemSchema>;

const MotionBase = {
  id: Id,
  fromFrame: Frame,
  durationInFrames: PositiveFrames,
  box: BoxSchema,
  fontFamily: z.string().max(64).optional(),
};

export const HookTitleItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("hook_title"),
  text: z.string().min(1).max(90),
  emphasis: z.array(z.string().max(40)).max(3).default([]),
  color: ColorRef.default("#FFFFFF"),
  accentColor: ColorRef.default("accent"),
});

export const LowerThirdItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("lower_third"),
  name: z.string().min(1).max(60),
  role: z.string().max(80).default(""),
  color: ColorRef.default("primary"),
  accentColor: ColorRef.default("accent"),
});

export const CalloutItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("callout"),
  text: z.string().min(1).max(60),
  color: ColorRef.default("accent"),
});

export const CtaItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("cta"),
  headline: z.string().min(1).max(80),
  subline: z.string().max(120).default(""),
  color: ColorRef.default("accent"),
  showLogo: z.boolean().default(true),
});

export const ProgressBarItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("progress_bar"),
  color: ColorRef.default("accent"),
});

export const LogoItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("logo"),
  assetId: Id,
  opacity: z.number().min(0.2).max(1).default(0.92),
});

export const FooterItemSchema = z.strictObject({
  ...MotionBase,
  kind: z.literal("footer"),
  text: z.string().min(1).max(80),
  color: ColorRef.default("#FFFFFF"),
});

export const MotionItemSchema = z.discriminatedUnion("kind", [
  HookTitleItemSchema,
  LowerThirdItemSchema,
  CalloutItemSchema,
  CtaItemSchema,
  ProgressBarItemSchema,
  LogoItemSchema,
  FooterItemSchema,
]);
export type MotionItem = z.infer<typeof MotionItemSchema>;
export type MotionKind = MotionItem["kind"];
export const TEXT_MOTION_KINDS: ReadonlySet<MotionKind> = new Set(["hook_title", "lower_third", "callout", "cta", "footer"]);

export const DuckingSchema = z.strictObject({
  enabled: z.boolean(),
  duckedVolume: z.number().min(0).max(1),
  attackFrames: z.number().int().min(0).max(60).default(6),
  releaseFrames: z.number().int().min(0).max(90).default(12),
  /** Composition frame ranges where speech happens and the item must be ducked. */
  ranges: z.array(z.tuple([Frame, Frame])).max(2000).default([]),
});

export const AudioItemSchema = z.strictObject({
  id: Id,
  kind: z.enum(["music", "sfx", "voiceover"]),
  assetId: Id,
  fromFrame: Frame,
  durationInFrames: PositiveFrames,
  sourceStartMs: z.number().min(0).default(0),
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().int().min(0).max(300).default(15),
  fadeOutFrames: z.number().int().min(0).max(300).default(30),
  loop: z.boolean().default(true),
  ducking: DuckingSchema.optional(),
  /** Origin of the audio for compliance (licence / generated / owned). */
  origin: z.string().min(2).max(200),
});
export type AudioItem = z.infer<typeof AudioItemSchema>;

const TrackBase = { id: Id, locked: z.boolean().default(false), muted: z.boolean().default(false) };

export const VideoTrackSchema = z.strictObject({ ...TrackBase, type: z.literal("video"), items: z.array(VideoItemSchema).max(2000) });
export const CaptionsTrackSchema = z.strictObject({ ...TrackBase, type: z.literal("captions"), items: z.array(CaptionItemSchema).max(4000) });
export const MotionTrackSchema = z.strictObject({ ...TrackBase, type: z.literal("motion"), items: z.array(MotionItemSchema).max(500) });
export const AudioTrackSchema = z.strictObject({ ...TrackBase, type: z.literal("audio"), items: z.array(AudioItemSchema).max(200) });

export const TrackSchema = z.discriminatedUnion("type", [VideoTrackSchema, CaptionsTrackSchema, MotionTrackSchema, AudioTrackSchema]);
export type Track = z.infer<typeof TrackSchema>;
export type VideoTrack = z.infer<typeof VideoTrackSchema>;
export type CaptionsTrack = z.infer<typeof CaptionsTrackSchema>;
export type MotionTrack = z.infer<typeof MotionTrackSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

export const CompositionSchema = z.strictObject({
  width: z.number().int().min(256).max(3840),
  height: z.number().int().min(256).max(3840),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  durationInFrames: PositiveFrames.max(30 * 60 * 15),
  backgroundColor: HexColor.default("#000000"),
});
export type Composition = z.infer<typeof CompositionSchema>;

export const EditPlanSchema = z.strictObject({
  schemaVersion: z.literal(EDIT_PLAN_SCHEMA_VERSION),
  projectId: Id,
  composition: CompositionSchema,
  tracks: z.array(TrackSchema).min(1).max(16),
  brandId: Id,
  templateId: Id,
  metadata: z.strictObject({
    createdBy: z.string().min(1).max(80),
    createdAt: z.string().datetime(),
    basedOnVersion: z.number().int().min(1).nullable().default(null),
    notes: z.string().max(2000).default(""),
  }),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type EditPlanInput = z.input<typeof EditPlanSchema>;

/** Platform UI safe zones per aspect, in percent of frame. Text must stay inside them. */
export const SAFE_ZONES = {
  "9:16": { top: 8, bottom: 12, side: 6 },
  "1:1": { top: 5, bottom: 6, side: 5 },
  "16:9": { top: 5, bottom: 8, side: 5 },
} as const;

export function aspectOf(width: number, height: number): keyof typeof SAFE_ZONES {
  const r = width / height;
  if (r < 0.8) return "9:16";
  if (r > 1.25) return "16:9";
  return "1:1";
}

export function findTrack<T extends Track["type"]>(plan: EditPlan, type: T): Extract<Track, { type: T }> | undefined {
  return plan.tracks.find((t) => t.type === type) as Extract<Track, { type: T }> | undefined;
}
