import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import {
  BriefContentSchema,
  newId,
  type CreateBrandRequest,
  type CreateCommentRequest,
  type CreateProjectRequest,
  type JobState,
  type TranscriptPatchRequest,
  type UpdateBrandRequest,
  type UpdateCommentRequest,
} from "@cmf/schemas";
import { isSelectable, templateForObjective } from "@cmf/templates";
import type { UserActor } from "./commands";
import { emitEvent } from "./events";
import { getBrand, getProject, NotFoundError, ValidationFailedError } from "./repos";
import { TransitionError } from "./state";

export async function createBrand(db: Db, user: UserActor, input: z.infer<typeof CreateBrandRequest>) {
  const id = newId("brand");
  await db.insert(tables.brands).values({
    id,
    organizationId: user.organizationId,
    name: input.name,
    brandTokensJson: input.brandTokens,
    toneRulesJson: input.toneRules,
    complianceRulesJson: input.complianceRules,
    defaultTemplateId: input.defaultTemplateId,
  });
  await emitEvent(db, { organizationId: user.organizationId, projectId: null, actorType: "user", actorId: user.id, eventType: "brand.updated", payload: { brandId: id, action: "created" } });
  return id;
}

export async function updateBrand(db: Db, user: UserActor, brandId: string, input: z.infer<typeof UpdateBrandRequest>) {
  await getBrand(db, user.organizationId, brandId);
  await db
    .update(tables.brands)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.brandTokens ? { brandTokensJson: input.brandTokens } : {}),
      ...(input.toneRules ? { toneRulesJson: input.toneRules } : {}),
      ...(input.complianceRules ? { complianceRulesJson: input.complianceRules } : {}),
      ...(input.defaultTemplateId ? { defaultTemplateId: input.defaultTemplateId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tables.brands.id, brandId), eq(tables.brands.organizationId, user.organizationId)));
  await emitEvent(db, { organizationId: user.organizationId, projectId: null, actorType: "user", actorId: user.id, eventType: "brand.updated", payload: { brandId, fields: Object.keys(input) } });
}

export async function createProject(db: Db, user: UserActor, input: z.infer<typeof CreateProjectRequest>) {
  const brand = await getBrand(db, user.organizationId, input.brandId);
  const templateId = input.templateId ?? brand.row.defaultTemplateId ?? templateForObjective(input.brief.objective).id;
  if (!isSelectable(templateId)) throw new ValidationFailedError("template indisponível", [{ path: "templateId", message: `template ${templateId} não está disponível` }]);
  const id = newId("project");
  const traceId = newId("trace");
  await db.transaction(async (trx) => {
    await trx.insert(tables.projects).values({
      id,
      organizationId: user.organizationId,
      brandId: brand.row.id,
      title: input.title,
      objective: input.brief.objective,
      channel: input.brief.channel,
      templateId,
      ownerId: user.id,
      aiMode: input.aiMode,
      costPolicyJson: input.costPolicy,
      traceId,
    });
    await trx.insert(tables.briefs).values({ id: newId("brief"), projectId: id, version: 1, contentJson: input.brief, createdBy: user.id });
    await trx.insert(tables.stateTransitions).values({ projectId: id, fromState: "DRAFT", toState: "DRAFT", actorType: "user", actorId: user.id, reason: "projeto criado" });
  });
  await emitEvent(db, { organizationId: user.organizationId, projectId: id, actorType: "user", actorId: user.id, eventType: "project.created", payload: { title: input.title, brandId: brand.row.id, templateId }, traceId });
  return id;
}

const BRIEF_EDITABLE: JobState[] = ["DRAFT", "ASSETS_UPLOADING", "AWAITING_BRIEF_APPROVAL"];

export async function addBriefVersion(db: Db, user: UserActor, projectId: string, content: unknown) {
  const project = await getProject(db, user.organizationId, projectId);
  if (!BRIEF_EDITABLE.includes(project.status as JobState)) throw new TransitionError(`briefing não pode ser alterado no estado ${project.status}`);
  const parsed = BriefContentSchema.parse(content);
  const [{ v }] = (await db.select({ v: sql<number>`coalesce(max(${tables.briefs.version}),0)` }).from(tables.briefs).where(eq(tables.briefs.projectId, projectId))) as [{ v: number }];
  const id = newId("brief");
  await db.insert(tables.briefs).values({ id, projectId, version: Number(v) + 1, contentJson: parsed, createdBy: user.id });
  await db.update(tables.projects).set({ objective: parsed.objective, channel: parsed.channel, updatedAt: new Date() }).where(eq(tables.projects.id, projectId));
  await emitEvent(db, { organizationId: user.organizationId, projectId, actorType: "user", actorId: user.id, eventType: "brief.version.created", payload: { briefId: id, version: Number(v) + 1 }, traceId: project.traceId });
  return { id, version: Number(v) + 1 };
}

export async function createComment(db: Db, user: UserActor, renderId: string, input: z.infer<typeof CreateCommentRequest>) {
  const [render] = await db.select().from(tables.renders).where(eq(tables.renders.id, renderId));
  if (!render) throw new NotFoundError("render");
  const project = await getProject(db, user.organizationId, render.projectId);
  if (input.timecodeMs > (render.durationMs ?? 0) + 50) throw new ValidationFailedError("timecode fora do vídeo", [{ path: "timecodeMs", message: "timecode além da duração do render" }]);
  if (input.kind === "cut" && (input.endTimecodeMs === null || input.endTimecodeMs <= input.timecodeMs))
    throw new ValidationFailedError("corte inválido", [{ path: "endTimecodeMs", message: "informe o fim do trecho a remover" }]);
  if (input.kind === "text_fix" && !input.replacement?.trim()) throw new ValidationFailedError("correção inválida", [{ path: "replacement", message: "informe o texto correto" }]);
  const id = newId("comment");
  await db.insert(tables.reviewComments).values({
    id,
    projectId: project.id,
    renderId,
    authorId: user.id,
    timecodeMs: input.timecodeMs,
    endTimecodeMs: input.endTimecodeMs,
    kind: input.kind,
    replacement: input.replacement,
    body: input.body,
    parentId: input.parentId,
  });
  await emitEvent(db, { organizationId: user.organizationId, projectId: project.id, actorType: "user", actorId: user.id, eventType: "review.comment.created", payload: { commentId: id, renderId, timecodeMs: input.timecodeMs, kind: input.kind }, traceId: project.traceId });
  return id;
}

export async function updateComment(db: Db, user: UserActor, commentId: string, input: z.infer<typeof UpdateCommentRequest>) {
  const [c] = await db.select().from(tables.reviewComments).where(eq(tables.reviewComments.id, commentId));
  if (!c) throw new NotFoundError("comentário");
  const project = await getProject(db, user.organizationId, c.projectId);
  if (input.body && c.authorId !== user.id) throw new TransitionError("apenas o autor pode editar o texto do comentário", "FORBIDDEN");
  await db.update(tables.reviewComments).set({ ...(input.status ? { status: input.status } : {}), ...(input.body ? { body: input.body } : {}) }).where(eq(tables.reviewComments.id, commentId));
  await emitEvent(db, { organizationId: user.organizationId, projectId: project.id, actorType: "user", actorId: user.id, eventType: "review.comment.updated", payload: { commentId, ...input }, traceId: project.traceId });
}

/** Manual transcript correction: creates a new transcript version (history preserved). */
export async function patchTranscript(db: Db, user: UserActor, projectId: string, input: z.infer<typeof TranscriptPatchRequest>) {
  const project = await getProject(db, user.organizationId, projectId);
  const [t] = await db
    .select()
    .from(tables.transcripts)
    .where(and(eq(tables.transcripts.assetId, input.assetId), eq(tables.transcripts.projectId, project.id)))
    .orderBy(desc(tables.transcripts.version))
    .limit(1);
  if (!t) throw new NotFoundError("transcrição");
  const words = structuredClone(t.wordsJson as { text: string; startMs: number; endMs: number; confidence: number | null }[]);
  const segments = structuredClone(t.segmentsJson as { text: string; wordStart: number; wordEnd: number }[]);
  for (const e of input.edits) {
    const w = words[e.wordIndex];
    if (!w) throw new ValidationFailedError("palavra inexistente", [{ path: `edits.${e.wordIndex}`, message: "índice fora da transcrição" }]);
    words[e.wordIndex] = { ...w, text: e.text, confidence: 1 };
  }
  for (const s of segments) s.text = words.slice(s.wordStart, s.wordEnd + 1).map((w) => w.text).join(" ");
  const id = newId("transcript");
  await db.insert(tables.transcripts).values({
    id,
    assetId: t.assetId,
    projectId: project.id,
    version: t.version + 1,
    language: t.language,
    segmentsJson: segments,
    wordsJson: words,
    text: words.map((w) => w.text).join(" "),
    provider: t.provider,
    model: t.model,
    confidence: t.confidence,
    editedBy: user.id,
  });
  await emitEvent(db, { organizationId: user.organizationId, projectId: project.id, actorType: "user", actorId: user.id, eventType: "transcript.edited", payload: { assetId: t.assetId, transcriptId: id, version: t.version + 1, edits: input.edits.length }, traceId: project.traceId });
  return { id, version: t.version + 1 };
}
