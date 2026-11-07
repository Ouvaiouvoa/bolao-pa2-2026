import { z } from "zod";

export const CHANNELS = ["instagram_reels", "instagram_stories", "tiktok", "youtube_shorts", "youtube", "linkedin", "internal"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

export const CHANNEL_LABELS: Record<Channel, string> = {
  instagram_reels: "Instagram Reels",
  instagram_stories: "Instagram Stories",
  tiktok: "TikTok",
  youtube_shorts: "YouTube Shorts",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  internal: "Uso interno / treinamento",
};

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export const Aspect = z.enum(ASPECTS);
export type Aspect = z.infer<typeof Aspect>;

export const ASPECT_DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const OBJECTIVES = ["authority", "offer", "testimonial", "tutorial", "podcast_cut", "training", "institutional", "before_after"] as const;
export const Objective = z.enum(OBJECTIVES);
export type Objective = z.infer<typeof Objective>;

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  authority: "Autoridade",
  offer: "Oferta",
  testimonial: "Depoimento",
  tutorial: "Tutorial",
  podcast_cut: "Corte de podcast/entrevista",
  training: "Treinamento",
  institutional: "Institucional",
  before_after: "Comparação antes/depois",
};

export const BriefContentSchema = z.strictObject({
  objective: Objective,
  goalStatement: z.string().min(10, "descreva o objetivo em pelo menos 10 caracteres").max(1200),
  channel: Channel,
  formats: z.array(Aspect).min(1).max(3).default(["9:16"]),
  audience: z.string().max(600).default(""),
  keyMessages: z.array(z.string().min(2).max(200)).max(10).default([]),
  keywords: z.array(z.string().min(2).max(40)).max(20).default([]),
  cta: z.strictObject({
    text: z.string().min(2).max(80),
    url: z.string().url().max(400).nullable().default(null),
  }),
  tone: z.string().max(200).default(""),
  durationTargetSec: z
    .strictObject({ min: z.number().int().min(5).max(600), max: z.number().int().min(5).max(900) })
    .refine((d) => d.max >= d.min, "duração máxima deve ser maior ou igual à mínima")
    .default({ min: 25, max: 60 }),
  speaker: z
    .strictObject({ name: z.string().min(1).max(80), role: z.string().max(120).default("") })
    .nullable()
    .default(null),
  restrictions: z.array(z.string().min(2).max(300)).max(20).default([]),
  approvedExamples: z.array(z.string().max(400)).max(10).default([]),
  rejectedExamples: z.array(z.string().max(400)).max(10).default([]),
  variantsAB: z.boolean().default(false),
  headline: z.string().max(80).nullable().default(null),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("pt-BR"),
});
export type BriefContent = z.infer<typeof BriefContentSchema>;
export type BriefContentInput = z.input<typeof BriefContentSchema>;
