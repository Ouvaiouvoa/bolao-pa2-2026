import { eq } from "drizzle-orm";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import { checkTransition, type JobState, type TransitionActor, WORKING_STATES } from "@cmf/schemas";
import { emitEvent } from "./events";
import { getStageQueue, stageIdempotencyKey } from "./queue";

export class TransitionError extends Error {
  constructor(message: string, readonly code = "INVALID_TRANSITION") {
    super(message);
    this.name = "TransitionError";
  }
}

export interface Actor {
  type: "user" | "agent" | "system";
  id: string;
}

export interface StageMarker {
  stage: JobState;
  attempt: number;
  seq: number;
  enqueuedAt: string;
  reason: string;
  hold?: { kind: "compliance" | "budget"; approvalRequestId: string; message: string } | null;
}

/**
 * Persists a state transition (author, timestamp, reason) after validating it against the
 * transition table. Runs in a transaction with a row lock so concurrent transitions serialise.
 * When the target is a working state the stage job is enqueued (idempotent per attempt).
 */
export async function transitionProject(
  db: Db,
  params: { projectId: string; organizationId: string; to: JobState; actor: Actor; reason: string; enqueue?: boolean },
): Promise<{ from: JobState; to: JobState; attempt: number | null }> {
  const transitionActor: TransitionActor = params.actor.type === "user" ? "human" : "system";
  const result = await db.transaction(async (trx) => {
    const [project] = await trx.select().from(tables.projects).where(eq(tables.projects.id, params.projectId)).for("update");
    if (!project || project.organizationId !== params.organizationId) throw new TransitionError("projeto não encontrado", "NOT_FOUND");
    const from = project.status as JobState;
    const check = checkTransition(from, params.to, transitionActor);
    if (!check.ok) throw new TransitionError(check.reason ?? "transição inválida");
    const prevMarker = project.stageJson as StageMarker | null;
    const attempt = WORKING_STATES.has(params.to) ? (prevMarker && prevMarker.stage === params.to ? prevMarker.attempt + 1 : 1) : null;
    const seq = attempt ? project.stageSeq + 1 : project.stageSeq;
    const marker: StageMarker | null = attempt
      ? { stage: params.to, attempt, seq, enqueuedAt: new Date().toISOString(), reason: params.reason, hold: null }
      : null;
    await trx
      .update(tables.projects)
      .set({
        status: params.to,
        stageJson: marker,
        stageSeq: seq,
        lastError: null,
        updatedAt: new Date(),
        ...(params.to === "REVISION_REQUESTED" ? { revisionRound: project.revisionRound + 1 } : {}),
      })
      .where(eq(tables.projects.id, params.projectId));
    await trx.insert(tables.stateTransitions).values({
      projectId: params.projectId,
      fromState: from,
      toState: params.to,
      actorType: params.actor.type,
      actorId: params.actor.id,
      reason: params.reason,
    });
    await emitEvent(trx as unknown as Db, {
      organizationId: params.organizationId,
      projectId: params.projectId,
      actorType: params.actor.type,
      actorId: params.actor.id,
      eventType: "project.state.changed",
      payload: { from, to: params.to, reason: params.reason, attempt },
      traceId: project.traceId,
    });
    return { from, to: params.to, attempt, seq, traceId: project.traceId };
  });
  if (result.attempt && params.enqueue !== false) {
    await getStageQueue().enqueue({
      projectId: params.projectId,
      organizationId: params.organizationId,
      stage: params.to,
      attempt: result.attempt,
      seq: result.seq,
      traceId: result.traceId,
      reason: params.reason,
      idempotencyKey: stageIdempotencyKey(params.projectId, params.to, result.seq),
    });
  }
  return { from: result.from, to: result.to, attempt: result.attempt };
}

/** Re-enqueues the current working stage with a new attempt number (manual retry / hold released). */
export async function requeueCurrentStage(db: Db, params: { projectId: string; organizationId: string; actor: Actor; reason: string }): Promise<{ stage: JobState; attempt: number }> {
  const res = await db.transaction(async (trx) => {
    const [project] = await trx.select().from(tables.projects).where(eq(tables.projects.id, params.projectId)).for("update");
    if (!project || project.organizationId !== params.organizationId) throw new TransitionError("projeto não encontrado", "NOT_FOUND");
    const stage = project.status as JobState;
    if (!WORKING_STATES.has(stage)) throw new TransitionError(`projeto em ${stage} não possui etapa em execução para reprocessar`);
    const prev = project.stageJson as StageMarker | null;
    const attempt = (prev?.stage === stage ? prev.attempt : 0) + 1;
    const seq = project.stageSeq + 1;
    const marker: StageMarker = { stage, attempt, seq, enqueuedAt: new Date().toISOString(), reason: params.reason, hold: null };
    await trx.update(tables.projects).set({ stageJson: marker, stageSeq: seq, lastError: null, updatedAt: new Date() }).where(eq(tables.projects.id, params.projectId));
    await emitEvent(trx as unknown as Db, {
      organizationId: params.organizationId,
      projectId: params.projectId,
      actorType: params.actor.type,
      actorId: params.actor.id,
      eventType: "agent.run.retry_requested",
      payload: { stage, attempt, reason: params.reason },
      traceId: project.traceId,
    });
    return { stage, attempt, seq, traceId: project.traceId };
  });
  await getStageQueue().enqueue({
    projectId: params.projectId,
    organizationId: params.organizationId,
    stage: res.stage,
    attempt: res.attempt,
    seq: res.seq,
    traceId: res.traceId,
    reason: params.reason,
    idempotencyKey: stageIdempotencyKey(params.projectId, res.stage, res.seq),
  });
  return { stage: res.stage, attempt: res.attempt };
}
