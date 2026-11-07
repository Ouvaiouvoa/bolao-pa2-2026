import { and, desc, eq } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";
import { AGENT_MODULES, AgentBlockedError, AgentFailure, createLlmClient, type AgentContext } from "@cmf/agents";
import { getDb, tables, type Db } from "@cmf/db";
import { MediaToolError } from "@cmf/media";
import { createLogger, startTimer, withSpan } from "@cmf/observability";
import {
  complianceClearance,
  emitEvent,
  getProject,
  latestArtifact,
  latestBrief,
  projectCostPolicy,
  requestApproval,
  spendSnapshot,
  stableHash,
  transitionProject,
  type Actor,
  type StageJobData,
  type StageMarker,
} from "@cmf/orchestration";
import { checkBudget, newId, STAGE_AGENTS, type ComplianceReport, type JobState, type QaReport } from "@cmf/schemas";
import { createAgentTools, ToolPolicyError, type ToolCallRecord } from "./tools";

const log = createLogger({ service: "cmf-worker" });
const ORCHESTRATOR: Actor = { type: "system", id: "orchestrator" };

interface OrgSettings {
  ai?: { allowExternalProviders?: boolean };
}

export interface StageResult {
  status: "completed" | "held" | "stale";
  next?: JobState;
}

function errorInfo(err: unknown, stage: JobState) {
  if (err instanceof AgentFailure) return { code: err.code, message: err.message, stage, retryable: err.retryable };
  if (err instanceof ToolPolicyError) return { code: "TOOL_POLICY", message: err.message, stage, retryable: false };
  if (err instanceof MediaToolError) return { code: `MEDIA_${err.code}`, message: err.message, stage, retryable: err.retryable, detail: err.stderrTail.slice(-600) };
  const e = err as Error;
  return { code: "UNEXPECTED", message: e?.message ?? String(err), stage, retryable: true };
}

/**
 * Orchestrator ("Diretor de Produção" in code — manager-as-tools pattern): executes the
 * specialists of a stage in order, reuses checkpoints, enforces budget and human gates and
 * transitions the job. Agents never transition state or approve anything themselves.
 */
export async function runStage(data: StageJobData, jobAttempt = 0, db: Db = getDb()): Promise<StageResult> {
  const project = await getProject(db, data.organizationId, data.projectId);
  const marker = project.stageJson as StageMarker | null;
  if (project.status !== data.stage || !marker || marker.seq !== data.seq) {
    log.info("stage.stale", { projectId: project.id, jobStage: data.stage, projectState: project.status, attempt: data.attempt });
    return { status: "stale" };
  }
  const stage = data.stage;
  const agents = STAGE_AGENTS[stage] ?? [];
  const [org] = await db.select().from(tables.organizations).where(eq(tables.organizations.id, project.organizationId));
  const allowExternalAi = Boolean((org?.settingsJson as OrgSettings | undefined)?.ai?.allowExternalProviders);
  const aiMode = project.aiMode as AgentContext["aiMode"];
  const llm = createLlmClient({ aiMode, allowExternal: allowExternalAi });
  const policy = projectCostPolicy(project);

  return withSpan(`stage.${stage}`, { "cmf.trace_id": project.traceId, "cmf.project_id": project.id, "cmf.attempt": data.attempt }, async () => {
    for (const agentType of agents) {
      // QA blocked → no delivery package.
      if (agentType === "distribution") {
        const qa = await latestArtifact<QaReport>(db, project.id, "qa_report");
        if (qa?.payload.band === "blocked") continue;
      }
      const mod = AGENT_MODULES[agentType];
      const runId = newId("agentRun");
      const calls: ToolCallRecord[] = [];
      const logs: { at: string; msg: string; fields?: Record<string, unknown> }[] = [];
      let inputHash = "";
      const usage = { model: null as string | null, tokensIn: 0, tokensOut: 0, costCents: 0 };
      let lastProgressEmit = 0;
      const evBase = { organizationId: project.organizationId, projectId: project.id, actorType: "agent" as const, actorId: runId, traceId: project.traceId };
      const ctx: AgentContext = {
        projectId: project.id,
        organizationId: project.organizationId,
        runId,
        traceId: project.traceId,
        agentType,
        stage,
        attempt: data.attempt,
        aiMode,
        policy: { allowExternalAi },
        llm,
        tools: createAgentTools({ db, project, agentType, runId, inputHash: () => inputHash, traceId: project.traceId, calls }),
        async progress(fraction, task, phase) {
          const now = Date.now();
          await db.update(tables.agentRuns).set({ progress: fraction, currentTask: task ?? null }).where(eq(tables.agentRuns.id, runId));
          if (now - lastProgressEmit > 900 || fraction >= 1 || phase === "reading_inputs") {
            lastProgressEmit = now;
            await emitEvent(db, { ...evBase, eventType: "agent.run.progress", payload: { agentType, runId, progress: Math.round(fraction * 1000) / 1000, task: task ?? null, phase: phase ?? "working" } });
          }
        },
        log(message, fields) {
          logs.push({ at: new Date().toISOString(), msg: message, fields });
          log.info(`agent.${agentType}.${message}`, { runId, projectId: project.id, ...fields });
        },
        recordUsage(u) {
          usage.model = u.model;
          usage.tokensIn += u.tokensIn;
          usage.tokensOut += u.tokensOut;
          usage.costCents += u.costCents;
        },
      };

      const inputs = await mod.inputs(ctx);
      inputHash = stableHash({ agent: agentType, version: mod.version, stage, inputs });

      // Checkpoint reuse: identical inputs + successful previous run → no recomputation.
      if (mod.cacheable) {
        const [prev] = await db
          .select()
          .from(tables.agentRuns)
          .where(and(eq(tables.agentRuns.projectId, project.id), eq(tables.agentRuns.agentType, agentType), eq(tables.agentRuns.inputHash, inputHash), eq(tables.agentRuns.status, "succeeded")))
          .orderBy(desc(tables.agentRuns.finishedAt))
          .limit(1);
        if (prev) {
          await db.insert(tables.agentRuns).values({
            id: runId,
            projectId: project.id,
            organizationId: project.organizationId,
            agentType,
            stage,
            status: "cached",
            attempt: data.attempt,
            idempotencyKey: `${project.id}:${stage}:s${data.seq}:${agentType}:${jobAttempt}`,
            inputHash,
            inputRefsJson: inputs.refs,
            outputRefsJson: prev.outputRefsJson,
            model: prev.model,
            traceId: project.traceId,
            progress: 1,
            latencyMs: 0,
            startedAt: new Date(),
            finishedAt: new Date(),
            logsJson: [{ at: new Date().toISOString(), msg: `reutilizado da execução ${prev.id}` }],
          });
          await emitEvent(db, { ...evBase, eventType: "agent.run.cached", payload: { agentType, runId, reusedRunId: prev.id, outputRefs: prev.outputRefsJson } });
          continue;
        }
      }

      // Budget guard before running (section 22).
      const estimate = (await mod.estimateCostCents?.(ctx)) ?? {};
      const llmEstimate = llm && ["director", "writer", "compliance"].includes(agentType) ? { aiCents: 3 } : {};
      const spent = await spendSnapshot(db, project.id);
      const check = checkBudget(policy, spent, { aiCents: (estimate.aiCents ?? 0) + (llmEstimate.aiCents ?? 0) || undefined, renderCents: estimate.renderCents, agentSteps: 1 });
      if (!check.ok) {
        await db.insert(tables.agentRuns).values({
          id: runId,
          projectId: project.id,
          organizationId: project.organizationId,
          agentType,
          stage,
          status: "blocked",
          attempt: data.attempt,
          idempotencyKey: `${project.id}:${stage}:s${data.seq}:${agentType}:${jobAttempt}`,
          inputHash,
          inputRefsJson: inputs.refs,
          traceId: project.traceId,
          errorJson: { code: "BUDGET_EXCEEDED", message: check.message, stage, retryable: true },
          startedAt: new Date(),
          finishedAt: new Date(),
        });
        const reqId = await requestApproval(db, { project, artifactType: "budget", artifactId: runId, reason: check.message ?? "limite de custo", requestedBy: { type: "agent", id: runId } });
        await emitEvent(db, { ...evBase, eventType: "agent.run.blocked", payload: { agentType, runId, code: "BUDGET_EXCEEDED", message: check.message } });
        await emitEvent(db, { ...evBase, actorType: "system", actorId: "orchestrator", eventType: "budget.blocked", payload: { dimension: check.dimension, projected: check.projected, limit: check.limit, approvalRequestId: reqId } });
        await setHold(db, project.id, marker, { kind: "budget", approvalRequestId: reqId, message: check.message ?? "" });
        return { status: "held" };
      }

      await db.insert(tables.agentRuns).values({
        id: runId,
        projectId: project.id,
        organizationId: project.organizationId,
        agentType,
        stage,
        status: "running",
        attempt: data.attempt,
        idempotencyKey: `${project.id}:${stage}:s${data.seq}:${agentType}:${jobAttempt}`,
        inputHash,
        inputRefsJson: inputs.refs,
        traceId: project.traceId,
        startedAt: new Date(),
      });
      await emitEvent(db, { ...evBase, eventType: "agent.run.started", payload: { agentType, runId, stage, attempt: data.attempt, task: `${mod.type} v${mod.version}`, phase: "reading_inputs", inputRefs: inputs.refs } });
      const timer = startTimer();
      try {
        const out = await withSpan(`agent.${agentType}`, { "cmf.trace_id": project.traceId, "cmf.run_id": runId }, () => mod.run(ctx));
        const latencyMs = timer();
        await db
          .update(tables.agentRuns)
          .set({
            status: "succeeded",
            outputRefsJson: out.outputRefs,
            model: usage.model ?? out.model,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            costCents: usage.costCents,
            latencyMs,
            progress: 1,
            currentTask: out.summary,
            logsJson: logs,
            toolCallsJson: calls,
            finishedAt: new Date(),
          })
          .where(eq(tables.agentRuns.id, runId));
        await emitEvent(db, { ...evBase, eventType: "agent.run.completed", payload: { agentType, runId, summary: out.summary, outputRefs: out.outputRefs, costCents: usage.costCents, latencyMs, model: usage.model ?? out.model } });
      } catch (err) {
        const info = err instanceof AgentBlockedError ? { code: err.code, message: err.message, stage, retryable: true } : errorInfo(err, stage);
        const status = err instanceof AgentBlockedError ? "blocked" : "failed";
        await db
          .update(tables.agentRuns)
          .set({ status, errorJson: info, latencyMs: timer(), logsJson: logs, toolCallsJson: calls, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costCents: usage.costCents, finishedAt: new Date() })
          .where(eq(tables.agentRuns.id, runId));
        await db.update(tables.projects).set({ lastError: { ...info, agentType, runId, at: new Date().toISOString() }, updatedAt: new Date() }).where(eq(tables.projects.id, project.id));
        await emitEvent(db, { ...evBase, eventType: status === "blocked" ? "agent.run.blocked" : "agent.run.failed", payload: { agentType, runId, ...info } });
        log.error("agent.failed", { runId, agentType, projectId: project.id, ...info });
        if (status === "blocked") return { status: "held" };
        // Only transient errors are retried automatically; everything else waits for a human retry.
        if (info.retryable && jobAttempt < 1) throw err;
        throw new UnrecoverableError(`${info.code}: ${info.message}`);
      }
    }
    return afterStage(db, project.id, project.organizationId, stage, marker);
  });
}

async function setHold(db: Db, projectId: string, marker: StageMarker, hold: NonNullable<StageMarker["hold"]>) {
  await db.update(tables.projects).set({ stageJson: { ...marker, hold }, updatedAt: new Date() }).where(eq(tables.projects.id, projectId));
}

/** Human gates and transitions after a stage completed (section 7). */
async function afterStage(db: Db, projectId: string, organizationId: string, stage: JobState, marker: StageMarker): Promise<StageResult> {
  const project = await getProject(db, organizationId, projectId);
  const next = async (to: JobState, reason: string): Promise<StageResult> => {
    await transitionProject(db, { projectId, organizationId, to, actor: ORCHESTRATOR, reason });
    return { status: "completed", next: to };
  };
  switch (stage) {
    case "INGESTING":
      return next("TRANSCRIBING", "ingestão concluída");
    case "TRANSCRIBING":
      return next("ANALYZING", "transcrição concluída");
    case "ANALYZING": {
      const r = await next("AWAITING_BRIEF_APPROVAL", "análise e direção criativa concluídas");
      const brief = await latestBrief(db, projectId);
      await requestApproval(db, { project, artifactType: "brief", artifactId: brief.row.id, reason: "direção criativa pronta — aprove o briefing para iniciar o roteiro", requestedBy: ORCHESTRATOR });
      return r;
    }
    case "SCRIPTING": {
      const r = await next("AWAITING_SCRIPT_APPROVAL", "roteiro gerado");
      const script = await latestArtifact(db, projectId, "script");
      if (script) await requestApproval(db, { project, artifactType: "script", artifactId: script.id, reason: "aprove o roteiro (e a variante) para iniciar a montagem", requestedBy: ORCHESTRATOR });
      return r;
    }
    case "ASSEMBLING": {
      const report = await latestArtifact<ComplianceReport>(db, projectId, "compliance_report");
      if (report?.payload.requiresHumanDecision) {
        const clearance = await complianceClearance(db, projectId, report);
        if (clearance.reused)
          await emitEvent(db, { organizationId, projectId, actorType: "system", actorId: "orchestrator", eventType: "compliance.clearance.reused", payload: { reportId: report.id, approvalIds: clearance.approvalIds, note: "achados de severidade alta idênticos aos já decididos por humano" }, traceId: project.traceId });
        if (!clearance.cleared) {
          const high = report.payload.findings.filter((f) => f.severity === "high").length;
          const reqId = await requestApproval(db, { project, artifactType: "compliance_report", artifactId: report.id, reason: `${high} alerta(s) de severidade alta exigem decisão humana`, requestedBy: ORCHESTRATOR });
          await emitEvent(db, { organizationId, projectId, actorType: "system", actorId: "orchestrator", eventType: "agent.run.blocked", payload: { agentType: "compliance", runId: report.agentRunId, code: "COMPLIANCE_HOLD", message: `${high} alerta(s) alto(s) aguardando decisão humana`, approvalRequestId: reqId }, traceId: project.traceId });
          await setHold(db, projectId, marker, { kind: "compliance", approvalRequestId: reqId, message: "alertas de compliance aguardando decisão humana" });
          return { status: "held" };
        }
      }
      return next("PREVIEW_RENDERING", "montagem validada");
    }
    case "PREVIEW_RENDERING": {
      const r = await next("IN_REVIEW", "preview renderizado");
      const [render] = await db
        .select()
        .from(tables.renders)
        .where(and(eq(tables.renders.projectId, projectId), eq(tables.renders.kind, "preview"), eq(tables.renders.status, "succeeded")))
        .orderBy(desc(tables.renders.createdAt))
        .limit(1);
      if (render) await requestApproval(db, { project, artifactType: "render_preview", artifactId: render.id, reason: "revise o preview, comente por timecode e aprove ou solicite ajustes", requestedBy: ORCHESTRATOR });
      return r;
    }
    case "FINAL_RENDERING":
      return next("QA_CHECKING", "master renderizado");
    case "QA_CHECKING": {
      const qa = await latestArtifact<QaReport>(db, projectId, "qa_report");
      if (!qa || qa.payload.band === "blocked") {
        const r = await next("BLOCKED", `QA bloqueou a entrega (nota ${qa?.payload.score ?? "—"})`);
        await emitEvent(db, { organizationId, projectId, actorType: "system", actorId: "orchestrator", eventType: "qa.blocked", payload: { score: qa?.payload.score ?? null, blockers: qa?.payload.blockers ?? [] }, traceId: project.traceId });
        return r;
      }
      await emitEvent(db, { organizationId, projectId, actorType: "system", actorId: "orchestrator", eventType: "qa.completed", payload: { score: qa.payload.score, band: qa.payload.band }, traceId: project.traceId });
      const r = await next("READY_TO_DELIVER", `QA nota ${qa.payload.score} (${qa.payload.band})`);
      await requestApproval(db, { project, artifactType: "render_master", artifactId: qa.payload.renderId, reason: `QA ${qa.payload.score}/100 — aprove o master para entrega`, requestedBy: ORCHESTRATOR });
      const pkg = await latestArtifact(db, projectId, "delivery_package");
      await emitEvent(db, { organizationId, projectId, actorType: "system", actorId: "orchestrator", eventType: "delivery.ready", payload: { renderId: qa.payload.renderId, packageArtifactId: pkg?.id ?? null }, traceId: project.traceId });
      return r;
    }
    default:
      return { status: "completed" };
  }
}
