import { z } from "zod";

/** Section 7 — persisted job states. */
export const JOB_STATES = [
  "DRAFT",
  "ASSETS_UPLOADING",
  "INGESTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AWAITING_BRIEF_APPROVAL",
  "SCRIPTING",
  "AWAITING_SCRIPT_APPROVAL",
  "ASSEMBLING",
  "PREVIEW_RENDERING",
  "IN_REVIEW",
  "REVISION_REQUESTED",
  "APPROVED",
  "FINAL_RENDERING",
  "QA_CHECKING",
  "READY_TO_DELIVER",
  "BLOCKED",
  "DELIVERED",
] as const;
export const JobState = z.enum(JOB_STATES);
export type JobState = z.infer<typeof JobState>;

export const JOB_STATE_LABELS: Record<JobState, string> = {
  DRAFT: "Rascunho",
  ASSETS_UPLOADING: "Enviando materiais",
  INGESTING: "Ingestão",
  TRANSCRIBING: "Transcrição",
  ANALYZING: "Análise",
  AWAITING_BRIEF_APPROVAL: "Aguardando aprovação do briefing",
  SCRIPTING: "Roteiro",
  AWAITING_SCRIPT_APPROVAL: "Aguardando aprovação do roteiro",
  ASSEMBLING: "Montagem",
  PREVIEW_RENDERING: "Render de preview",
  IN_REVIEW: "Em revisão",
  REVISION_REQUESTED: "Ajustes solicitados",
  APPROVED: "Preview aprovado",
  FINAL_RENDERING: "Render final",
  QA_CHECKING: "Controle de qualidade",
  READY_TO_DELIVER: "Pronto para entrega",
  BLOCKED: "Bloqueado",
  DELIVERED: "Entregue",
};

/** States where the worker is executing a stage (machine work). */
export const WORKING_STATES = new Set<JobState>([
  "INGESTING",
  "TRANSCRIBING",
  "ANALYZING",
  "SCRIPTING",
  "ASSEMBLING",
  "PREVIEW_RENDERING",
  "FINAL_RENDERING",
  "QA_CHECKING",
]);

/** States waiting for a human decision. */
export const HUMAN_GATE_STATES = new Set<JobState>([
  "AWAITING_BRIEF_APPROVAL",
  "AWAITING_SCRIPT_APPROVAL",
  "IN_REVIEW",
  "REVISION_REQUESTED",
  "APPROVED",
  "READY_TO_DELIVER",
  "BLOCKED",
]);

export type TransitionActor = "system" | "human";

interface TransitionRule {
  to: JobState;
  actor: TransitionActor;
  /** Human transitions that require an Approval record (never inferred). */
  requiresApproval?: "brief" | "script" | "render_preview" | "render_master";
}

/** The complete transition table. Anything not listed here is rejected. */
export const TRANSITIONS: Record<JobState, TransitionRule[]> = {
  DRAFT: [
    { to: "ASSETS_UPLOADING", actor: "system" },
    { to: "INGESTING", actor: "human" },
  ],
  ASSETS_UPLOADING: [{ to: "INGESTING", actor: "human" }],
  INGESTING: [{ to: "TRANSCRIBING", actor: "system" }],
  TRANSCRIBING: [{ to: "ANALYZING", actor: "system" }],
  ANALYZING: [{ to: "AWAITING_BRIEF_APPROVAL", actor: "system" }],
  AWAITING_BRIEF_APPROVAL: [
    { to: "SCRIPTING", actor: "human", requiresApproval: "brief" },
    { to: "ANALYZING", actor: "human" },
  ],
  SCRIPTING: [{ to: "AWAITING_SCRIPT_APPROVAL", actor: "system" }],
  AWAITING_SCRIPT_APPROVAL: [
    { to: "ASSEMBLING", actor: "human", requiresApproval: "script" },
    { to: "SCRIPTING", actor: "human" },
  ],
  ASSEMBLING: [
    { to: "PREVIEW_RENDERING", actor: "system" },
    // Compliance hold rejected by a human: back to scripting without the flagged material.
    { to: "SCRIPTING", actor: "human" },
  ],
  PREVIEW_RENDERING: [{ to: "IN_REVIEW", actor: "system" }],
  IN_REVIEW: [
    { to: "REVISION_REQUESTED", actor: "human" },
    { to: "APPROVED", actor: "human", requiresApproval: "render_preview" },
    { to: "PREVIEW_RENDERING", actor: "human" },
  ],
  REVISION_REQUESTED: [
    { to: "ASSEMBLING", actor: "system" },
    { to: "PREVIEW_RENDERING", actor: "human" },
  ],
  APPROVED: [
    { to: "FINAL_RENDERING", actor: "human" },
    { to: "REVISION_REQUESTED", actor: "human" },
  ],
  FINAL_RENDERING: [{ to: "QA_CHECKING", actor: "system" }],
  QA_CHECKING: [
    { to: "READY_TO_DELIVER", actor: "system" },
    { to: "BLOCKED", actor: "system" },
  ],
  READY_TO_DELIVER: [
    { to: "DELIVERED", actor: "human", requiresApproval: "render_master" },
    { to: "REVISION_REQUESTED", actor: "human" },
  ],
  BLOCKED: [
    { to: "REVISION_REQUESTED", actor: "human" },
    { to: "QA_CHECKING", actor: "human" },
  ],
  DELIVERED: [],
};

export interface TransitionCheck {
  ok: boolean;
  rule?: TransitionRule;
  reason?: string;
}

export function checkTransition(from: JobState, to: JobState, actor: TransitionActor): TransitionCheck {
  const rule = TRANSITIONS[from].find((r) => r.to === to);
  if (!rule) return { ok: false, reason: `transição ${from} → ${to} não permitida` };
  if (rule.actor !== actor) return { ok: false, reason: `transição ${from} → ${to} exige ator ${rule.actor === "human" ? "humano" : "sistema"}` };
  return { ok: true, rule };
}

/** Linear "happy path" order — used by progress bars and analytics. */
export const HAPPY_PATH: JobState[] = [
  "DRAFT",
  "ASSETS_UPLOADING",
  "INGESTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AWAITING_BRIEF_APPROVAL",
  "SCRIPTING",
  "AWAITING_SCRIPT_APPROVAL",
  "ASSEMBLING",
  "PREVIEW_RENDERING",
  "IN_REVIEW",
  "APPROVED",
  "FINAL_RENDERING",
  "QA_CHECKING",
  "READY_TO_DELIVER",
  "DELIVERED",
];

export function progressOf(state: JobState): number {
  const idx = HAPPY_PATH.indexOf(state);
  if (idx < 0) return state === "REVISION_REQUESTED" ? HAPPY_PATH.indexOf("IN_REVIEW") / (HAPPY_PATH.length - 1) : 0.85;
  return idx / (HAPPY_PATH.length - 1);
}
