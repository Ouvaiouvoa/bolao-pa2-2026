import { z } from "zod";
import type { JobState } from "./job-state";

export const AGENT_TYPES = [
  "director",
  "ingest",
  "transcript",
  "curator",
  "writer",
  "editor",
  "motion",
  "captions",
  "audio",
  "brand",
  "compliance",
  "qa",
  "render",
  "distribution",
] as const;
export const AgentType = z.enum(AGENT_TYPES);
export type AgentType = z.infer<typeof AgentType>;

export const AGENT_RUN_STATUSES = ["queued", "running", "waiting_dependency", "blocked", "succeeded", "failed", "cached", "cancelled"] as const;
export const AgentRunStatus = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

/** Tools any agent may call (section 16). */
export const COMMON_TOOLS = [
  "read_project_brief",
  "list_project_assets",
  "read_transcript",
  "read_brand_tokens",
  "read_template",
  "create_artifact",
  "validate_edit_plan",
  "request_human_approval",
  "report_blocker",
  "read_artifact",
  "read_edit_plan",
  "list_review_comments",
  "list_approvals",
  "store_project_file",
  "read_project_metrics",
] as const;

/** Restricted tools need an explicit policy grant + audit trail. */
export const RESTRICTED_TOOLS = [
  "render_media",
  "read_original_media",
  "paid_external_call",
  "publish_external",
  "delete_object",
  "modify_brand_rules",
  "register_media",
  "save_transcript",
  "register_generated_asset",
  "save_edit_plan",
  "resolve_review_comments",
] as const;

export type CommonTool = (typeof COMMON_TOOLS)[number];
export type RestrictedTool = (typeof RESTRICTED_TOOLS)[number];
export type AgentTool = CommonTool | RestrictedTool;

export interface AgentDefinition {
  type: AgentType;
  label: string;
  role: string;
  stages: JobState[];
  dependsOn: AgentType[];
  restrictedTools: RestrictedTool[];
  /** Artifact types this agent produces. */
  produces: string[];
  /** Agents that are never allowed to approve their own output. */
  canApprove: false;
}

export const AGENTS: Record<AgentType, AgentDefinition> = {
  director: {
    type: "director",
    label: "Diretor",
    role: "Interpreta o briefing, define estratégia e critérios de aceitação",
    stages: ["ANALYZING"],
    dependsOn: ["transcript"],
    restrictedTools: ["paid_external_call"],
    produces: ["creative_direction"],
    canApprove: false,
  },
  ingest: {
    type: "ingest",
    label: "Ingest",
    role: "Valida, registra e normaliza mídia (proxy, waveform, thumbnails)",
    stages: ["INGESTING"],
    dependsOn: [],
    restrictedTools: ["read_original_media", "register_media"],
    produces: ["media_manifest"],
    canApprove: false,
  },
  transcript: {
    type: "transcript",
    label: "Transcrição",
    role: "Transcreve a fala com timestamps por palavra",
    stages: ["TRANSCRIBING"],
    dependsOn: ["ingest"],
    restrictedTools: ["paid_external_call", "save_transcript"],
    produces: ["transcript"],
    canApprove: false,
  },
  curator: {
    type: "curator",
    label: "Curador",
    role: "Encontra os melhores trechos com justificativa",
    stages: ["ANALYZING"],
    dependsOn: ["director", "transcript"],
    restrictedTools: ["paid_external_call"],
    produces: ["selects"],
    canApprove: false,
  },
  writer: {
    type: "writer",
    label: "Roteirista",
    role: "Cria narrativa, gancho, progressão e CTA",
    stages: ["SCRIPTING"],
    dependsOn: ["curator"],
    restrictedTools: ["paid_external_call"],
    produces: ["script"],
    canApprove: false,
  },
  editor: {
    type: "editor",
    label: "Editor",
    role: "Converte roteiro e selects em timeline (edit_plan.json)",
    stages: ["ASSEMBLING"],
    dependsOn: ["writer"],
    restrictedTools: ["save_edit_plan", "save_transcript", "resolve_review_comments"],
    produces: ["edit_plan"],
    canApprove: false,
  },
  captions: {
    type: "captions",
    label: "Legendas",
    role: "Segmentação, destaque semântico e legibilidade",
    stages: ["ASSEMBLING"],
    dependsOn: ["editor"],
    restrictedTools: ["save_edit_plan"],
    produces: ["captions"],
    canApprove: false,
  },
  motion: {
    type: "motion",
    label: "Motion",
    role: "Títulos, chamadas, lower thirds e CTA editáveis",
    stages: ["ASSEMBLING"],
    dependsOn: ["editor"],
    restrictedTools: ["save_edit_plan"],
    produces: ["motion_plan"],
    canApprove: false,
  },
  audio: {
    type: "audio",
    label: "Áudio",
    role: "Normalização, trilha, ducking e mixagem",
    stages: ["ASSEMBLING"],
    dependsOn: ["editor"],
    restrictedTools: ["save_edit_plan", "register_generated_asset", "read_original_media"],
    produces: ["audio_plan"],
    canApprove: false,
  },
  brand: {
    type: "brand",
    label: "Marca",
    role: "Verifica tokens, área segura, fontes, cores, logo e tom",
    stages: ["ASSEMBLING"],
    dependsOn: ["captions", "motion", "audio"],
    restrictedTools: [],
    produces: ["brand_report"],
    canApprove: false,
  },
  compliance: {
    type: "compliance",
    label: "Compliance",
    role: "Sinaliza alegações sensíveis, dados pessoais e termos proibidos",
    stages: ["ASSEMBLING"],
    dependsOn: ["captions", "motion"],
    restrictedTools: ["paid_external_call"],
    produces: ["compliance_report"],
    canApprove: false,
  },
  render: {
    type: "render",
    label: "Render",
    role: "Gera preview e master com hashes e métricas",
    stages: ["PREVIEW_RENDERING", "FINAL_RENDERING"],
    dependsOn: ["brand", "compliance"],
    restrictedTools: ["render_media", "read_original_media"],
    produces: ["render_report"],
    canApprove: false,
  },
  qa: {
    type: "qa",
    label: "QA",
    role: "Valida qualidade técnica, editorial, marca e compliance",
    stages: ["QA_CHECKING"],
    dependsOn: ["render"],
    restrictedTools: [],
    produces: ["qa_report"],
    canApprove: false,
  },
  distribution: {
    type: "distribution",
    label: "Distribuição",
    role: "Prepara o pacote de publicação (sem publicar no MVP)",
    stages: ["QA_CHECKING"],
    dependsOn: ["qa"],
    restrictedTools: [],
    produces: ["delivery_package"],
    canApprove: false,
  },
};

/** Stage → ordered agent list executed by the orchestrator. */
export const STAGE_AGENTS: Partial<Record<JobState, AgentType[]>> = {
  INGESTING: ["ingest"],
  TRANSCRIBING: ["transcript"],
  ANALYZING: ["director", "curator"],
  SCRIPTING: ["writer"],
  ASSEMBLING: ["editor", "captions", "motion", "audio", "brand", "compliance"],
  PREVIEW_RENDERING: ["render"],
  FINAL_RENDERING: ["render"],
  QA_CHECKING: ["qa", "distribution"],
};
