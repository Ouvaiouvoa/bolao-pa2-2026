import { z } from "zod";
import { Aspect, Channel, Objective } from "./brief";

/** Artifact types persisted by agents. Every agent output is validated against one of these before storage. */
export const ARTIFACT_TYPES = [
  "media_manifest",
  "transcript",
  "creative_direction",
  "selects",
  "script",
  "edit_plan",
  "captions",
  "motion_plan",
  "audio_plan",
  "brand_report",
  "compliance_report",
  "render_report",
  "qa_report",
  "delivery_package",
  "revision_plan",
] as const;
export const ArtifactType = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactType>;

const Ms = z.number().min(0);
const Severity = z.enum(["info", "low", "medium", "high"]);
export type Severity = z.infer<typeof Severity>;

export const AlertSchema = z.object({ code: z.string(), severity: Severity, message: z.string() });

export const MediaManifestSchema = z.object({
  assetId: z.string(),
  original: z.object({ objectKey: z.string(), checksum: z.string(), mime: z.string(), sizeBytes: z.number().int() }),
  probe: z.object({
    durationMs: Ms,
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    fps: z.number().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    hasVideo: z.boolean(),
    hasAudio: z.boolean(),
    rotation: z.number(),
    sampleRate: z.number().nullable(),
    channels: z.number().nullable(),
    bitRate: z.number().nullable(),
    formatName: z.string(),
  }),
  proxy: z.object({ objectKey: z.string(), width: z.number().int(), height: z.number().int(), fps: z.number() }).nullable(),
  audioWav: z.object({ objectKey: z.string(), sampleRate: z.number().int() }).nullable(),
  waveform: z.object({ objectKey: z.string(), peaksPerSecond: z.number(), count: z.number().int() }).nullable(),
  thumbnails: z.array(z.object({ objectKey: z.string(), atMs: Ms })),
  orientation: z.enum(["landscape", "portrait", "square", "audio_only"]),
  framing: z.object({
    focusX: z.number().min(0).max(1),
    focusY: z.number().min(0).max(1),
    method: z.string(),
    confidence: z.number().min(0).max(1),
    segments: z.array(z.object({ startMs: Ms, endMs: Ms, focusX: z.number(), focusY: z.number(), confidence: z.number() })),
  }),
  silences: z.array(z.object({ startMs: Ms, endMs: Ms })),
  scenes: z.array(z.object({ atMs: Ms, score: z.number() })),
  loudness: z.object({ integratedLufs: z.number().nullable(), truePeakDb: z.number().nullable(), lra: z.number().nullable() }),
  alerts: z.array(AlertSchema),
});
export type MediaManifest = z.infer<typeof MediaManifestSchema>;

export const TranscriptWordSchema = z.object({
  text: z.string(),
  startMs: Ms,
  endMs: Ms,
  confidence: z.number().min(0).max(1).nullable(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  startMs: Ms,
  endMs: Ms,
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  wordStart: z.number().int().min(0),
  wordEnd: z.number().int().min(0),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptPayloadSchema = z.object({
  assetId: z.string(),
  language: z.string(),
  provider: z.string(),
  model: z.string(),
  durationMs: Ms,
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  segments: z.array(TranscriptSegmentSchema),
  words: z.array(TranscriptWordSchema),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;

export const AcceptanceCriterionSchema = z.object({ id: z.string(), description: z.string(), check: z.string() });

export const CreativeDirectionSchema = z.object({
  objective: Objective,
  channel: Channel,
  templateId: z.string(),
  aspect: Aspect,
  composition: z.object({ width: z.number().int(), height: z.number().int(), fps: z.number().int() }),
  targetDurationSec: z.object({ min: z.number(), max: z.number(), ideal: z.number() }),
  pacing: z.object({ removePausesOverMs: z.number(), cutPaddingMs: z.number(), punchInEveryNthCut: z.number().int() }),
  captionPreset: z.enum(["bold-pop", "clean", "karaoke"]),
  motionIntensity: z.enum(["low", "medium", "high"]),
  hookStrategy: z.string(),
  ctaText: z.string(),
  keywords: z.array(z.string()),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  tasks: z.array(z.object({ agent: z.string(), description: z.string(), estimatedCostCents: z.number() })),
  risks: z.array(z.string()),
  materialSummary: z.object({ assets: z.number().int(), speechMs: Ms, words: z.number().int(), language: z.string().nullable() }),
  rationale: z.string(),
});
export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>;

export const SelectScoresSchema = z.object({
  clarity: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
  emotion: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  adherence: z.number().min(0).max(1),
  total: z.number().min(0).max(1),
});
export type SelectScores = z.infer<typeof SelectScoresSchema>;

export const SelectCandidateSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  startMs: Ms,
  endMs: Ms,
  text: z.string(),
  wordStart: z.number().int(),
  wordEnd: z.number().int(),
  scores: SelectScoresSchema,
  selected: z.boolean(),
  role: z.enum(["hook", "body", "cta"]).nullable(),
  hookPotential: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  rejectedReason: z.string().nullable(),
  duplicateOf: z.string().nullable(),
});
export type SelectCandidate = z.infer<typeof SelectCandidateSchema>;

export const SelectsSchema = z.object({
  candidates: z.array(SelectCandidateSchema),
  selectedDurationMs: Ms,
  summary: z.string(),
});
export type Selects = z.infer<typeof SelectsSchema>;

export const ScriptBeatSchema = z.object({
  id: z.string(),
  kind: z.enum(["hook", "body", "proof", "cta"]),
  selectId: z.string().nullable(),
  assetId: z.string().nullable(),
  startMs: Ms.nullable(),
  endMs: Ms.nullable(),
  text: z.string(),
  onScreenText: z.string().nullable(),
});
export type ScriptBeat = z.infer<typeof ScriptBeatSchema>;

export const ScriptVariantSchema = z.object({
  id: z.enum(["A", "B"]),
  hookTitle: z.string().min(1).max(90),
  hookEmphasis: z.array(z.string()).max(3),
  beats: z.array(ScriptBeatSchema).min(1),
  ctaText: z.string(),
  estimatedDurationSec: z.number(),
  rationale: z.string(),
});
export type ScriptVariant = z.infer<typeof ScriptVariantSchema>;

export const ScriptSchema = z.object({
  variants: z.array(ScriptVariantSchema).min(1).max(2),
  chosenVariant: z.enum(["A", "B"]),
  publishCaption: z.string(),
  hashtags: z.array(z.string()),
});
export type Script = z.infer<typeof ScriptSchema>;

export const CheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail", "skip"]),
  detail: z.string(),
});
export type Check = z.infer<typeof CheckSchema>;

export const BrandReportSchema = z.object({
  ok: z.boolean(),
  score: z.number().min(0).max(100),
  checks: z.array(CheckSchema),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type BrandReport = z.infer<typeof BrandReportSchema>;

export const ComplianceFindingSchema = z.object({
  id: z.string(),
  severity: Severity,
  category: z.enum(["absolute_promise", "sensitive_claim", "personal_data", "prohibited_term", "sector_rule", "media_origin", "missing_disclaimer"]),
  text: z.string(),
  source: z.enum(["transcript", "on_screen", "brief", "audio", "script"]),
  atMs: Ms.nullable(),
  rule: z.string(),
  suggestion: z.string(),
});
export type ComplianceFinding = z.infer<typeof ComplianceFindingSchema>;

export const ComplianceReportSchema = z.object({
  ok: z.boolean(),
  highestSeverity: z.enum(["none", "info", "low", "medium", "high"]),
  findings: z.array(ComplianceFindingSchema),
  requiresHumanDecision: z.boolean(),
  checkedSources: z.array(z.string()),
});
export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

export const AudioPlanSchema = z.object({
  measuredSourceLufs: z.number().nullable(),
  voiceGain: z.number(),
  music: z.object({ assetId: z.string(), origin: z.string(), volume: z.number(), duckedVolume: z.number() }).nullable(),
  speechRanges: z.number().int(),
  masterTargetLufs: z.number(),
  truePeakDb: z.number(),
  notes: z.array(z.string()),
});
export type AudioPlan = z.infer<typeof AudioPlanSchema>;

export const CaptionsArtifactSchema = z.object({
  pages: z.number().int(),
  highlightedWords: z.array(z.string()),
  srtKey: z.string(),
  vttKey: z.string(),
  maxCharsObserved: z.number().int(),
});
export type CaptionsArtifact = z.infer<typeof CaptionsArtifactSchema>;

export const MotionPlanSchema = z.object({
  items: z.array(z.object({ id: z.string(), kind: z.string(), fromFrame: z.number().int(), durationInFrames: z.number().int(), text: z.string() })),
  intensity: z.string(),
});
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export const RenderReportSchema = z.object({
  renderId: z.string(),
  kind: z.enum(["preview", "final"]),
  objectKey: z.string(),
  thumbnailKey: z.string().nullable(),
  durationMs: Ms,
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number(),
  codec: z.string(),
  audioCodec: z.string().nullable(),
  fileSize: z.number().int(),
  checksum: z.string(),
  renderMs: z.number(),
  framesRendered: z.number().int(),
  costCents: z.number(),
  loudness: z.object({ integratedLufs: z.number().nullable(), truePeakDb: z.number().nullable() }),
});
export type RenderReport = z.infer<typeof RenderReportSchema>;

export const QaDimensionSchema = z.object({ score: z.number().min(0).max(100), checks: z.array(CheckSchema) });
export const QaReportSchema = z.object({
  renderId: z.string(),
  score: z.number().min(0).max(100),
  band: z.enum(["ready", "ready_with_alerts", "revision_required", "blocked"]),
  dimensions: z.object({ technical: QaDimensionSchema, editorial: QaDimensionSchema, brand: QaDimensionSchema, compliance: QaDimensionSchema }),
  blockers: z.array(z.string()),
  alerts: z.array(z.string()),
  note: z.string(),
});
export type QaReport = z.infer<typeof QaReportSchema>;

/** Section 20 — score policy. A high score never replaces human approval. */
export function qaBand(score: number, hasBlocker: boolean): QaReport["band"] {
  if (hasBlocker || score < 60) return "blocked";
  if (score < 75) return "revision_required";
  if (score < 90) return "ready_with_alerts";
  return "ready";
}

export const DeliveryPackageSchema = z.object({
  renderId: z.string(),
  files: z.array(z.object({ name: z.string(), kind: z.string(), objectKey: z.string(), checksum: z.string(), sizeBytes: z.number().int() })),
  publishCaption: z.string(),
  hashtags: z.array(z.string()),
  ctaText: z.string(),
  costReport: z.object({ aiCents: z.number(), renderCents: z.number(), totalCents: z.number(), byAgent: z.record(z.string(), z.number()) }),
  timeReport: z.object({ totalMs: z.number(), byStage: z.record(z.string(), z.number()) }),
  agents: z.array(z.string()),
  publishing: z.literal("not_published"),
});
export type DeliveryPackage = z.infer<typeof DeliveryPackageSchema>;

export const RevisionPlanSchema = z.object({
  basedOnEditPlanVersion: z.number().int(),
  applied: z.array(z.object({ commentId: z.string(), action: z.string(), detail: z.string() })),
  skipped: z.array(z.object({ commentId: z.string(), reason: z.string() })),
  /** Cumulative list of motion elements removed by reviewers ("kind|text"). */
  suppressedMotion: z.array(z.string()),
});
export type RevisionPlan = z.infer<typeof RevisionPlanSchema>;

export const ARTIFACT_SCHEMAS: Partial<Record<ArtifactType, z.ZodType>> = {
  media_manifest: MediaManifestSchema,
  transcript: TranscriptPayloadSchema,
  creative_direction: CreativeDirectionSchema,
  selects: SelectsSchema,
  script: ScriptSchema,
  captions: CaptionsArtifactSchema,
  motion_plan: MotionPlanSchema,
  audio_plan: AudioPlanSchema,
  brand_report: BrandReportSchema,
  compliance_report: ComplianceReportSchema,
  render_report: RenderReportSchema,
  qa_report: QaReportSchema,
  delivery_package: DeliveryPackageSchema,
  revision_plan: RevisionPlanSchema,
};
