import type {
  AgentType,
  ApprovalArtifactType,
  ArtifactType,
  BrandTokens,
  BriefContent,
  ComplianceRules,
  EditPlan,
  EditPlanIssue,
  JobState,
  ToneRules,
  TranscriptPayload,
} from "@cmf/schemas";
import type { TemplateDefinition } from "@cmf/templates";
import type { LlmClient } from "./llm";

export interface AssetInfo {
  id: string;
  type: "video" | "audio" | "image" | "music";
  status: string;
  originalName: string;
  mimeType: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  objectKey: string;
  proxyKey: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown>;
}

export interface BrandInfo {
  brandId: string;
  name: string;
  tokens: BrandTokens;
  tone: ToneRules;
  compliance: ComplianceRules;
  logoAssetId: string | null;
  musicAssets: { id: string; origin: string; durationMs: number | null }[];
}

export interface ReviewCommentInfo {
  id: string;
  kind: "note" | "cut" | "text_fix" | "remove_motion";
  timecodeMs: number;
  endTimecodeMs: number | null;
  replacement: string | null;
  body: string;
  status: string;
  renderId: string;
  renderEditPlanId: string | null;
}

export interface ApprovalInfo {
  artifactType: string;
  artifactId: string;
  decision: "granted" | "rejected";
  reason: string;
  createdAt: string;
}

export interface RenderOutput {
  renderId: string;
  objectKey: string;
  thumbnailKey: string | null;
  localPath: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  audioCodec: string | null;
  fileSize: number;
  checksum: string;
  renderMs: number;
  framesRendered: number;
  costCents: number;
  loudness: { integratedLufs: number | null; truePeakDb: number | null };
}

/**
 * Tools exposed to agents (section 16). The worker implements them with policy checks:
 * restricted tools are only callable by agents that were granted them, and every call is
 * recorded on the agent run (tool_calls_json) for audit.
 */
export interface AgentTools {
  // ── common ───────────────────────────────────────────────
  readProjectBrief(): Promise<{ briefId: string; version: number; content: BriefContent; approved: boolean; projectTitle: string; templateId: string }>;
  listProjectAssets(): Promise<AssetInfo[]>;
  readTranscript(assetId: string): Promise<(TranscriptPayload & { transcriptId: string; version: number }) | null>;
  readBrandTokens(): Promise<BrandInfo>;
  readTemplate(templateId: string): Promise<TemplateDefinition>;
  readArtifact<T>(type: ArtifactType): Promise<{ id: string; version: number; checksum: string; payload: T } | null>;
  readEditPlan(editPlanId?: string): Promise<{ id: string; version: number; plan: EditPlan } | null>;
  listReviewComments(): Promise<ReviewCommentInfo[]>;
  listApprovals(): Promise<ApprovalInfo[]>;
  createArtifact(type: ArtifactType, payload: unknown, opts?: { objectKey?: string }): Promise<{ id: string; version: number; checksum: string }>;
  storeProjectFile(name: string, source: { path: string } | { data: Buffer | string }, contentType: string): Promise<string>;
  validateEditPlan(payload: unknown): Promise<EditPlanIssue[]>;
  requestHumanApproval(artifactType: ApprovalArtifactType, artifactId: string, reason: string): Promise<string>;
  reportBlocker(code: string, details: string): Promise<void>;
  complianceClearance(): Promise<{ cleared: boolean; approvalIds: string[]; reused: boolean }>;
  readProjectMetrics(): Promise<{ aiCents: number; renderCents: number; totalCents: number; byAgent: Record<string, number>; byStageMs: Record<string, number>; totalMs: number; agents: string[] }>;
  // ── restricted ───────────────────────────────────────────
  readOriginalMedia(assetId: string): Promise<string>;
  materialize(objectKey: string): Promise<string>;
  registerMedia(assetId: string, patch: Partial<Pick<AssetInfo, "status" | "durationMs" | "width" | "height" | "fps" | "proxyKey" | "checksum" | "mimeType">> & { codec?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
  saveTranscript(payload: TranscriptPayload, editedBy?: string | null): Promise<{ transcriptId: string; version: number }>;
  registerGeneratedAsset(type: "music", localPath: string, meta: { originalName: string; durationMs: number; origin: string }): Promise<string>;
  saveEditPlan(payload: unknown, note: string): Promise<{ id: string; version: number; issues: EditPlanIssue[] }>;
  resolveReviewComments(ids: string[], editPlanId: string): Promise<void>;
  renderMedia(kind: "preview" | "final", editPlanId: string, onProgress: (f: number) => void): Promise<RenderOutput>;
}

export interface AgentContext {
  projectId: string;
  organizationId: string;
  runId: string;
  traceId: string;
  agentType: AgentType;
  stage: JobState;
  attempt: number;
  aiMode: "deterministic" | "llm_assisted";
  policy: { allowExternalAi: boolean };
  tools: AgentTools;
  /** Present only when the project allows LLM assistance, the org policy allows external AI and a key is configured. */
  llm: LlmClient | null;
  progress(fraction: number, task?: string, phase?: "reading_inputs" | "working" | "writing_outputs"): Promise<void>;
  log(message: string, fields?: Record<string, unknown>): void;
  /** Accumulates model/provider usage on the agent run (tokens and cost). */
  recordUsage(usage: { model: string; tokensIn: number; tokensOut: number; costCents: number }): void;
  signal?: AbortSignal;
}

export interface AgentOutput {
  summary: string;
  outputRefs: { type: string; id: string; version?: number }[];
  /** Model actually used ("heuristic-v1" for the deterministic engine). */
  model: string;
}

export interface AgentInputs {
  refs: { kind: string; id: string; version?: number | string; checksum?: string }[];
  /** Extra values that influence the output (config, versions). */
  params?: Record<string, unknown>;
}

export interface AgentModule {
  type: AgentType;
  /** Bump when logic changes to invalidate cached outputs. */
  version: string;
  /** Collects the inputs that determine the output — used for checkpoint/cache reuse. */
  inputs(ctx: AgentContext): Promise<AgentInputs>;
  /** Whether a previous successful run with identical inputs may be reused. */
  cacheable: boolean;
  /** Rough cost estimate (US cents) before running, for budget checks. */
  estimateCostCents?(ctx: AgentContext): Promise<{ aiCents?: number; renderCents?: number }>;
  run(ctx: AgentContext): Promise<AgentOutput>;
}

export class AgentBlockedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentBlockedError";
  }
}

export class AgentFailure extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
    this.name = "AgentFailure";
  }
}
