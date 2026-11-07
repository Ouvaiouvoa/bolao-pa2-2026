import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import {
  checkBudget,
  CostPolicySchema,
  newId,
  type ApprovalArtifactType,
  type JobState,
} from "@cmf/schemas";
import type { z } from "zod";
import type { CreateApprovalRequest } from "@cmf/schemas";
import { emitEvent } from "./events";
import { getProject, latestArtifact, latestBrief, NotFoundError, projectCostPolicy, spendSnapshot, type ProjectRow } from "./repos";
import { requeueCurrentStage, transitionProject, TransitionError, type Actor } from "./state";

export interface UserActor {
  id: string;
  organizationId: string;
  role: string;
}

const userActor = (u: UserActor): Actor => ({ type: "user", id: u.id });
const ORCHESTRATOR: Actor = { type: "system", id: "orchestrator" };

export async function requestApproval(
  db: Db,
  input: { project: ProjectRow; artifactType: ApprovalArtifactType; artifactId: string; reason: string; requestedBy: Actor },
): Promise<string> {
  await db
    .update(tables.approvalRequests)
    .set({ status: "superseded" })
    .where(
      and(
        eq(tables.approvalRequests.projectId, input.project.id),
        eq(tables.approvalRequests.artifactType, input.artifactType),
        eq(tables.approvalRequests.status, "open"),
      ),
    );
  const id = newId("approvalRequest");
  await db.insert(tables.approvalRequests).values({
    id,
    projectId: input.project.id,
    organizationId: input.project.organizationId,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    reason: input.reason,
    requestedByType: input.requestedBy.type,
    requestedById: input.requestedBy.id,
  });
  await emitEvent(db, {
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    actorType: input.requestedBy.type,
    actorId: input.requestedBy.id,
    eventType: "approval.requested",
    payload: { approvalRequestId: id, artifactType: input.artifactType, artifactId: input.artifactId, reason: input.reason },
    traceId: input.project.traceId,
  });
  return id;
}

export async function openApprovalRequests(db: Db, projectId: string) {
  return db
    .select()
    .from(tables.approvalRequests)
    .where(and(eq(tables.approvalRequests.projectId, projectId), eq(tables.approvalRequests.status, "open")))
    .orderBy(desc(tables.approvalRequests.createdAt));
}

async function latestRender(db: Db, projectId: string, kind: "preview" | "final") {
  const [row] = await db
    .select()
    .from(tables.renders)
    .where(and(eq(tables.renders.projectId, projectId), eq(tables.renders.kind, kind), eq(tables.renders.status, "succeeded")))
    .orderBy(desc(tables.renders.createdAt))
    .limit(1);
  return row ?? null;
}

/** Which artifact must be approved for a gate — approvals of stale versions are refused. */
async function expectedArtifactId(db: Db, project: ProjectRow, type: ApprovalArtifactType): Promise<string | null> {
  switch (type) {
    case "brief":
      return (await latestBrief(db, project.id)).row.id;
    case "script":
      return (await latestArtifact(db, project.id, "script"))?.id ?? null;
    case "render_preview":
      return (await latestRender(db, project.id, "preview"))?.id ?? null;
    case "render_master":
      return (await latestRender(db, project.id, "final"))?.id ?? null;
    case "compliance_report":
    case "budget": {
      const open = (await openApprovalRequests(db, project.id)).find((r) => r.artifactType === type);
      return open?.artifactId ?? null;
    }
  }
}

const GATE_STATE: Partial<Record<ApprovalArtifactType, JobState[]>> = {
  brief: ["AWAITING_BRIEF_APPROVAL"],
  script: ["AWAITING_SCRIPT_APPROVAL"],
  render_preview: ["IN_REVIEW"],
  render_master: ["READY_TO_DELIVER"],
};

/**
 * Records a human decision (never inferred) and advances the job accordingly.
 * Agents have no access to this command.
 */
export async function decideApproval(db: Db, user: UserActor, input: z.infer<typeof CreateApprovalRequest>) {
  const project = await getProject(db, user.organizationId, input.projectId);
  const state = project.status as JobState;
  const gate = GATE_STATE[input.artifactType];
  if (gate && !gate.includes(state)) throw new TransitionError(`não há aprovação de ${input.artifactType} pendente no estado ${state}`);
  const expected = await expectedArtifactId(db, project, input.artifactType);
  if (!expected) throw new NotFoundError(`artefato pendente de aprovação (${input.artifactType})`);
  if (expected !== input.artifactId) throw new TransitionError("a aprovação refere-se a uma versão desatualizada do artefato", "STALE_ARTIFACT");
  if (input.decision === "rejected" && input.reason.trim().length < 3) throw new TransitionError("informe o motivo da reprovação", "REASON_REQUIRED");

  const approvalId = newId("approval");
  await db.insert(tables.approvals).values({
    id: approvalId,
    projectId: project.id,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    decision: input.decision,
    reason: [input.reason, input.variant ? `variante ${input.variant}` : ""].filter(Boolean).join(" · "),
    decidedBy: user.id,
  });
  await db
    .update(tables.approvalRequests)
    .set({ status: "resolved", resolvedByApprovalId: approvalId })
    .where(
      and(
        eq(tables.approvalRequests.projectId, project.id),
        eq(tables.approvalRequests.artifactType, input.artifactType),
        eq(tables.approvalRequests.status, "open"),
      ),
    );
  await emitEvent(db, {
    organizationId: project.organizationId,
    projectId: project.id,
    actorType: "user",
    actorId: user.id,
    eventType: input.decision === "granted" ? "approval.granted" : "approval.rejected",
    payload: { approvalId, artifactType: input.artifactType, artifactId: input.artifactId, reason: input.reason, variant: input.variant ?? null },
    traceId: project.traceId,
  });

  const actor = userActor(user);
  const granted = input.decision === "granted";
  let transition: { from: JobState; to: JobState } | null = null;
  switch (input.artifactType) {
    case "brief":
      if (granted) {
        await db.update(tables.briefs).set({ approvedBy: user.id, approvedAt: new Date() }).where(eq(tables.briefs.id, input.artifactId));
        transition = await transitionProject(db, { projectId: project.id, organizationId: project.organizationId, to: "SCRIPTING", actor, reason: "briefing aprovado" });
      } else {
        transition = await transitionProject(db, { projectId: project.id, organizationId: project.organizationId, to: "ANALYZING", actor, reason: `briefing reprovado: ${input.reason}` });
      }
      break;
    case "script":
      transition = await transitionProject(db, {
        projectId: project.id,
        organizationId: project.organizationId,
        to: granted ? "ASSEMBLING" : "SCRIPTING",
        actor,
        reason: granted ? `roteiro aprovado${input.variant ? ` (variante ${input.variant})` : ""}` : `roteiro reprovado: ${input.reason}`,
      });
      break;
    case "render_preview":
      transition = granted
        ? await transitionProject(db, { projectId: project.id, organizationId: project.organizationId, to: "APPROVED", actor, reason: "preview aprovado" })
        : await requestRevision(db, user, project.id, input.reason);
      break;
    case "render_master":
      if (granted) {
        transition = await transitionProject(db, { projectId: project.id, organizationId: project.organizationId, to: "DELIVERED", actor, reason: "master aprovado" });
        await emitEvent(db, {
          organizationId: project.organizationId,
          projectId: project.id,
          actorType: "user",
          actorId: user.id,
          eventType: "delivery.completed",
          payload: { renderId: input.artifactId, publishing: "not_published" },
          traceId: project.traceId,
        });
      } else {
        transition = await requestRevision(db, user, project.id, input.reason);
      }
      break;
    case "compliance_report":
      if (granted) await requeueCurrentStage(db, { projectId: project.id, organizationId: project.organizationId, actor, reason: `compliance liberado: ${input.reason}` });
      else transition = await transitionProject(db, { projectId: project.id, organizationId: project.organizationId, to: "SCRIPTING", actor, reason: `compliance reprovado: ${input.reason}` });
      break;
    case "budget":
      if (granted) {
        if (!input.costPolicy) throw new TransitionError("informe os novos limites de custo para liberar o orçamento", "POLICY_REQUIRED");
        await db.update(tables.projects).set({ costPolicyJson: CostPolicySchema.parse(input.costPolicy), updatedAt: new Date() }).where(eq(tables.projects.id, project.id));
        await requeueCurrentStage(db, { projectId: project.id, organizationId: project.organizationId, actor, reason: "orçamento ampliado" });
      }
      break;
  }
  return { approvalId, transition };
}

export async function startProject(db: Db, user: UserActor, projectId: string) {
  const project = await getProject(db, user.organizationId, projectId);
  const assets = await db
    .select({ id: tables.assets.id })
    .from(tables.assets)
    .where(and(eq(tables.assets.projectId, project.id), inArray(tables.assets.status, ["uploaded", "ready"])));
  if (!assets.length) throw new TransitionError("envie ao menos um vídeo antes de iniciar", "NO_ASSETS");
  const pending = await db
    .select({ id: tables.uploads.id })
    .from(tables.uploads)
    .where(and(eq(tables.uploads.projectId, project.id), eq(tables.uploads.status, "pending"), isNull(tables.uploads.completedAt)));
  if (pending.length) throw new TransitionError("há uploads em andamento; aguarde a conclusão", "UPLOADS_PENDING");
  return transitionProject(db, { projectId, organizationId: user.organizationId, to: "INGESTING", actor: userActor(user), reason: "produção iniciada" });
}

/**
 * Human asks for changes. If structured comments (cut / text_fix / remove_motion) are open the
 * Editor agent applies them automatically; otherwise the job waits for manual timeline edits.
 */
export async function requestRevision(db: Db, user: UserActor, projectId: string, reason: string) {
  const project = await getProject(db, user.organizationId, projectId);
  const policy = projectCostPolicy(project);
  const spent = await spendSnapshot(db, project.id);
  const budget = checkBudget(policy, spent, { revisionRounds: 1 });
  if (!budget.ok) throw new TransitionError(budget.message ?? "limite de revisões atingido", "BUDGET_EXCEEDED");
  const t = await transitionProject(db, { projectId, organizationId: user.organizationId, to: "REVISION_REQUESTED", actor: userActor(user), reason: `ajustes solicitados: ${reason}` });
  const structured = await db
    .select({ id: tables.reviewComments.id })
    .from(tables.reviewComments)
    .where(
      and(
        eq(tables.reviewComments.projectId, projectId),
        eq(tables.reviewComments.status, "open"),
        inArray(tables.reviewComments.kind, ["cut", "text_fix", "remove_motion"]),
      ),
    );
  if (structured.length) {
    return transitionProject(db, { projectId, organizationId: user.organizationId, to: "ASSEMBLING", actor: ORCHESTRATOR, reason: `revisão automática de ${structured.length} comentário(s)` });
  }
  return t;
}

export async function requestPreviewRender(db: Db, user: UserActor, projectId: string) {
  const project = await getProject(db, user.organizationId, projectId);
  if (!["IN_REVIEW", "REVISION_REQUESTED"].includes(project.status)) throw new TransitionError(`não é possível gerar preview no estado ${project.status}`);
  if (!project.currentEditPlanId) throw new TransitionError("projeto sem edit plan", "NO_EDIT_PLAN");
  return transitionProject(db, { projectId, organizationId: user.organizationId, to: "PREVIEW_RENDERING", actor: userActor(user), reason: "novo preview solicitado" });
}

export async function requestFinalRender(db: Db, user: UserActor, projectId: string) {
  return transitionProject(db, { projectId, organizationId: user.organizationId, to: "FINAL_RENDERING", actor: userActor(user), reason: "renderização final liberada" });
}

export async function recheckQa(db: Db, user: UserActor, projectId: string) {
  return transitionProject(db, { projectId, organizationId: user.organizationId, to: "QA_CHECKING", actor: userActor(user), reason: "nova verificação de QA solicitada" });
}

export async function retryAgentRun(db: Db, user: UserActor, runId: string, reason: string) {
  const [run] = await db
    .select()
    .from(tables.agentRuns)
    .where(and(eq(tables.agentRuns.id, runId), eq(tables.agentRuns.organizationId, user.organizationId)));
  if (!run) throw new NotFoundError("execução de agente");
  if (!["failed", "blocked", "cancelled"].includes(run.status)) throw new TransitionError("apenas execuções com falha ou bloqueadas podem ser reprocessadas", "NOT_RETRYABLE");
  const project = await getProject(db, user.organizationId, run.projectId);
  if (project.status !== run.stage) throw new TransitionError(`o projeto já avançou para ${project.status}; retry não aplicável`, "STALE_RUN");
  return requeueCurrentStage(db, { projectId: project.id, organizationId: user.organizationId, actor: userActor(user), reason: `retry de ${run.agentType}: ${reason}` });
}
