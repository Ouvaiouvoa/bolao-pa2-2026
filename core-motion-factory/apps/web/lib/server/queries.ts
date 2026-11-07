import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getBrand, getProject, openApprovalRequests, projectCostPolicy, spendSnapshot, type SessionUser, type StageMarker } from "@cmf/orchestration";
import { ARTIFACT_TYPES, can, JOB_STATE_LABELS, PERMISSIONS, type ArtifactType, type EditPlan, type JobState } from "@cmf/schemas";
import { getStorage } from "@cmf/storage";
import { db } from "./db";

const SMALL_ARTIFACTS: ArtifactType[] = ["creative_direction", "selects", "script", "captions", "motion_plan", "audio_plan", "brand_report", "compliance_report", "render_report", "qa_report", "delivery_package", "revision_plan", "media_manifest"];

async function sign(key: string | null | undefined, downloadName?: string): Promise<string | null> {
  if (!key) return null;
  return getStorage().signedUrl(key, { expiresInSec: 3600, downloadName });
}

export async function loadProjectSnapshot(user: SessionUser, projectId: string) {
  const d = db();
  const project = await getProject(d, user.organizationId, projectId);
  const brand = await getBrand(d, user.organizationId, project.brandId);
  const briefs = await d.select().from(tables.briefs).where(eq(tables.briefs.projectId, projectId)).orderBy(desc(tables.briefs.version));
  const assets = await d.select().from(tables.assets).where(eq(tables.assets.projectId, projectId)).orderBy(asc(tables.assets.createdAt));
  const transcriptRows = await d.select().from(tables.transcripts).where(eq(tables.transcripts.projectId, projectId)).orderBy(desc(tables.transcripts.version));
  const latestTranscripts = new Map<string, (typeof transcriptRows)[number]>();
  for (const t of transcriptRows) if (!latestTranscripts.has(t.assetId)) latestTranscripts.set(t.assetId, t);
  const editPlans = await d.select().from(tables.editPlans).where(eq(tables.editPlans.projectId, projectId)).orderBy(desc(tables.editPlans.version));
  const renders = await d.select().from(tables.renders).where(eq(tables.renders.projectId, projectId)).orderBy(desc(tables.renders.createdAt));
  const comments = await d
    .select({ c: tables.reviewComments, author: tables.users.name })
    .from(tables.reviewComments)
    .innerJoin(tables.users, eq(tables.users.id, tables.reviewComments.authorId))
    .where(eq(tables.reviewComments.projectId, projectId))
    .orderBy(asc(tables.reviewComments.timecodeMs));
  const approvals = await d
    .select({ a: tables.approvals, by: tables.users.name })
    .from(tables.approvals)
    .innerJoin(tables.users, eq(tables.users.id, tables.approvals.decidedBy))
    .where(eq(tables.approvals.projectId, projectId))
    .orderBy(desc(tables.approvals.createdAt));
  const runs = await d.select().from(tables.agentRuns).where(eq(tables.agentRuns.projectId, projectId)).orderBy(desc(tables.agentRuns.createdAt)).limit(300);
  const artifactRows = await d.select().from(tables.artifacts).where(and(eq(tables.artifacts.projectId, projectId), inArray(tables.artifacts.type, SMALL_ARTIFACTS))).orderBy(desc(tables.artifacts.version));
  const latestArtifacts: Record<string, { id: string; version: number; payload: unknown; createdAt: string; checksum: string }> = {};
  for (const a of artifactRows) if (!latestArtifacts[a.type]) latestArtifacts[a.type] = { id: a.id, version: a.version, payload: a.payloadJson, createdAt: a.createdAt.toISOString(), checksum: a.checksum };
  const brandAssets = await d.select().from(tables.brandAssets).where(eq(tables.brandAssets.brandId, project.brandId));
  const canCost = can(user.role, "cost.view");
  const isClient = user.role === "client";

  const media: Record<string, { src: string; kind: "video" | "audio" | "image" }> = {};
  for (const a of assets) {
    const key = a.type === "video" ? a.proxyKey : a.status === "ready" ? a.objectKey : null;
    const url = await sign(key);
    if (url) media[a.id] = { src: url, kind: a.type === "video" ? "video" : "audio" };
  }
  for (const b of brandAssets) {
    if (b.type === "logo" || b.type === "music") {
      const url = await sign(b.objectKey);
      if (url) media[b.id] = { src: url, kind: b.type === "logo" ? "image" : "audio" };
    }
  }
  const delivery = latestArtifacts.delivery_package?.payload as { files: { name: string; kind: string; objectKey: string; checksum: string; sizeBytes: number }[] } | undefined;
  const downloads = delivery && can(user.role, "delivery.download") ? await Promise.all(delivery.files.map(async (f) => ({ ...f, url: await sign(f.objectKey, f.name), objectKey: undefined }))) : [];
  const captionsArt = latestArtifacts.captions?.payload as { srtKey: string; vttKey: string } | undefined;
  const marker = project.stageJson as StageMarker | null;
  const plan = editPlans[0];

  return {
    user: { id: user.id, name: user.name, role: user.role, permissions: PERMISSIONS.filter((p) => can(user.role, p)) as string[] },
    project: {
      id: project.id,
      title: project.title,
      status: project.status as JobState,
      statusLabel: JOB_STATE_LABELS[project.status as JobState],
      objective: project.objective,
      channel: project.channel,
      templateId: project.templateId,
      aiMode: project.aiMode,
      revisionRound: project.revisionRound,
      hold: marker?.hold ?? null,
      stage: marker ? { stage: marker.stage, attempt: marker.attempt } : null,
      lastError: project.lastError as { code: string; message: string; agentType?: string; runId?: string; retryable?: boolean } | null,
      costPolicy: canCost ? projectCostPolicy(project) : null,
      traceId: isClient ? null : project.traceId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    brand: { id: brand.row.id, name: brand.row.name, tokens: brand.tokens },
    /** Signed media URLs for the browser Player (proxies, logo, music). */
    media,
    brief: briefs[0] ? { id: briefs[0].id, version: briefs[0].version, content: briefs[0].contentJson, approvedAt: briefs[0].approvedAt?.toISOString() ?? null } : null,
    briefVersions: briefs.map((b) => ({ id: b.id, version: b.version, approvedAt: b.approvedAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString() })),
    assets: await Promise.all(
      assets.map(async (a) => {
        const meta = (a.metadataJson ?? {}) as { thumbnails?: { objectKey: string }[]; waveformKey?: string; framing?: unknown; loudness?: unknown; rejection?: string; error?: string; origin?: string };
        return {
          id: a.id,
          type: a.type,
          status: a.status,
          originalName: a.originalName,
          durationMs: a.durationMs,
          width: a.width,
          height: a.height,
          fps: a.fps,
          checksum: isClient ? null : a.checksum,
          proxyUrl: await sign(a.proxyKey),
          thumbUrl: await sign(meta.thumbnails?.[0]?.objectKey),
          waveformUrl: await sign(meta.waveformKey),
          framing: meta.framing ?? null,
          loudness: meta.loudness ?? null,
          problem: meta.rejection ?? meta.error ?? null,
          origin: meta.origin ?? null,
        };
      }),
    ),
    transcripts: [...latestTranscripts.values()].map((t) => ({ id: t.id, assetId: t.assetId, version: t.version, language: t.language, provider: t.provider, model: t.model, confidence: t.confidence, words: t.wordsJson as { text: string; startMs: number; endMs: number; confidence: number | null }[], segments: t.segmentsJson as { id: string; startMs: number; endMs: number; text: string; wordStart: number; wordEnd: number }[], editedBy: t.editedBy })),
    editPlan: plan ? { id: plan.id, version: plan.version, plan: plan.payloadJson as EditPlan, issues: plan.issuesJson as { code: string; severity: string; path: string; message: string }[], createdByType: plan.createdByType, createdById: plan.createdById, note: plan.note, createdAt: plan.createdAt.toISOString() } : null,
    editPlanVersions: editPlans.map((p) => ({ id: p.id, version: p.version, createdByType: p.createdByType, createdById: p.createdById, note: p.note, createdAt: p.createdAt.toISOString() })),
    renders: await Promise.all(
      renders.map(async (r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        editPlanId: r.editPlanId,
        editPlanVersion: editPlans.find((p) => p.id === r.editPlanId)?.version ?? null,
        url: r.status === "succeeded" ? await sign(r.objectKey) : null,
        thumbUrl: await sign(r.thumbnailKey),
        durationMs: r.durationMs,
        width: r.width,
        height: r.height,
        fps: r.fps,
        checksum: r.checksum,
        fileSize: r.fileSize,
        costCents: canCost ? r.costCents : null,
        metrics: isClient ? null : r.metricsJson,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
    ),
    comments: comments.map(({ c, author }) => ({ id: c.id, renderId: c.renderId, author, authorId: c.authorId, timecodeMs: c.timecodeMs, endTimecodeMs: c.endTimecodeMs, kind: c.kind, replacement: c.replacement, body: c.body, status: c.status, parentId: c.parentId, appliedInEditPlanId: c.appliedInEditPlanId, createdAt: c.createdAt.toISOString() })),
    approvalRequests: (await openApprovalRequests(d, projectId)).map((r) => ({ id: r.id, artifactType: r.artifactType, artifactId: r.artifactId, reason: r.reason, createdAt: r.createdAt.toISOString() })),
    approvals: approvals.map(({ a, by }) => ({ id: a.id, artifactType: a.artifactType, artifactId: a.artifactId, decision: a.decision, reason: a.reason, decidedBy: by, createdAt: a.createdAt.toISOString() })),
    agentRuns: isClient
      ? []
      : runs.map((r) => ({
          id: r.id,
          agentType: r.agentType,
          stage: r.stage,
          status: r.status,
          attempt: r.attempt,
          progress: r.progress,
          currentTask: r.currentTask,
          model: r.model,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costCents: canCost ? r.costCents : null,
          latencyMs: r.latencyMs,
          inputRefs: r.inputRefsJson,
          outputRefs: r.outputRefsJson,
          logs: r.logsJson,
          toolCalls: r.toolCallsJson,
          error: r.errorJson,
          traceId: r.traceId,
          startedAt: r.startedAt?.toISOString() ?? null,
          finishedAt: r.finishedAt?.toISOString() ?? null,
        })),
    artifacts: isClient ? pick(latestArtifacts, ["script", "qa_report", "brand_report", "compliance_report"]) : latestArtifacts,
    artifactTypes: ARTIFACT_TYPES,
    captionFiles: captionsArt ? { srt: await sign(captionsArt.srtKey, "legendas.srt"), vtt: await sign(captionsArt.vttKey, "legendas.vtt") } : null,
    downloads,
    costs: canCost ? await spendSnapshot(d, projectId) : null,
  };
}

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k))) as Partial<T>;
}

export type ProjectSnapshot = Awaited<ReturnType<typeof loadProjectSnapshot>>;
