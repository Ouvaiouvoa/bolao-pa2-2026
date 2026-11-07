import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AgentTools, AssetInfo, RenderOutput } from "@cmf/agents";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import { extractStill, loudnormMaster, measureLoudness, probe, sha256File } from "@cmf/media";
import {
  complianceClearance,
  assetRefsByIds,
  assetRefsFor,
  collectAssetIds,
  createArtifact,
  createEditPlanVersion,
  emitEvent,
  getBrand,
  getEditPlan,
  latestArtifact,
  latestBrief,
  latestEditPlan,
  requestApproval,
  type ProjectRow,
} from "@cmf/orchestration";
import { renderEditPlan, type LocalMedia } from "@cmf/renderer";
import { AGENTS, frameToMs, newId, RESTRICTED_TOOLS, validateEditPlan, type AgentTool, type AgentType, type TranscriptPayload } from "@cmf/schemas";
import { getStorage, objectKeys, organizationOfKey } from "@cmf/storage";
import { getTemplate } from "@cmf/templates";

export class ToolPolicyError extends Error {
  constructor(readonly tool: string, readonly agent: string) {
    super(`ferramenta restrita "${tool}" não autorizada para o agente ${agent}`);
    this.name = "ToolPolicyError";
  }
}

export interface ToolCallRecord {
  tool: string;
  at: string;
  ms: number;
  ok: boolean;
  restricted: boolean;
  detail?: string;
}

export interface ToolContext {
  db: Db;
  project: ProjectRow;
  agentType: AgentType;
  runId: string;
  inputHash: () => string;
  traceId: string;
  calls: ToolCallRecord[];
}

const RESTRICTED = new Set<string>(RESTRICTED_TOOLS);

function assetInfo(a: typeof tables.assets.$inferSelect): AssetInfo {
  return {
    id: a.id,
    type: a.type as AssetInfo["type"],
    status: a.status,
    originalName: a.originalName,
    mimeType: a.mimeType,
    durationMs: a.durationMs,
    width: a.width,
    height: a.height,
    fps: a.fps,
    objectKey: a.objectKey,
    proxyKey: a.proxyKey,
    checksum: a.checksum,
    sizeBytes: a.sizeBytes,
    metadata: (a.metadataJson ?? {}) as Record<string, unknown>,
  };
}

/**
 * Builds the tool surface for one agent run. Every call goes through `guard`, which enforces the
 * restricted-tool policy (section 16) and records the call on the run for audit.
 */
export function createAgentTools(tc: ToolContext): AgentTools {
  const { db, project } = tc;
  const org = project.organizationId;
  const storage = getStorage();
  const granted = new Set<string>(AGENTS[tc.agentType].restrictedTools);

  async function guard<T>(tool: AgentTool, fn: () => Promise<T>, detail?: string): Promise<T> {
    const restricted = RESTRICTED.has(tool);
    const t0 = Date.now();
    if (restricted && !granted.has(tool)) {
      tc.calls.push({ tool, at: new Date().toISOString(), ms: 0, ok: false, restricted, detail: "negado pela política" });
      await emitEvent(db, { organizationId: org, projectId: project.id, actorType: "agent", actorId: tc.runId, eventType: "agent.tool.called", payload: { agentType: tc.agentType, runId: tc.runId, tool, allowed: false }, traceId: tc.traceId });
      throw new ToolPolicyError(tool, tc.agentType);
    }
    try {
      const r = await fn();
      tc.calls.push({ tool, at: new Date(t0).toISOString(), ms: Date.now() - t0, ok: true, restricted, detail });
      if (restricted)
        await emitEvent(db, { organizationId: org, projectId: project.id, actorType: "agent", actorId: tc.runId, eventType: "agent.tool.called", payload: { agentType: tc.agentType, runId: tc.runId, tool, allowed: true, detail: detail ?? null }, traceId: tc.traceId });
      return r;
    } catch (err) {
      tc.calls.push({ tool, at: new Date(t0).toISOString(), ms: Date.now() - t0, ok: false, restricted, detail: (err as Error).message.slice(0, 200) });
      throw err;
    }
  }

  const projectKey = (name: string) => {
    if (!/^[A-Za-z0-9_\-./]+$/.test(name) || name.includes("..") || name.startsWith("/")) throw new Error(`nome de arquivo inválido: ${name}`);
    return `org/${org}/projects/${project.id}/${name}`;
  };
  const ensureTenantKey = (key: string) => {
    if (organizationOfKey(key) !== org) throw new Error("acesso a objeto de outra organização negado");
    return key;
  };

  const tools: AgentTools = {
    readProjectBrief: () =>
      guard("read_project_brief", async () => {
        const b = await latestBrief(db, project.id);
        return { briefId: b.row.id, version: b.row.version, content: b.content, approved: Boolean(b.row.approvedAt), projectTitle: project.title, templateId: project.templateId };
      }),
    listProjectAssets: () =>
      guard("list_project_assets", async () => {
        const rows = await db.select().from(tables.assets).where(eq(tables.assets.projectId, project.id)).orderBy(asc(tables.assets.createdAt));
        return rows.map(assetInfo);
      }),
    readTranscript: (assetId) =>
      guard("read_transcript", async () => {
        const [row] = await db
          .select()
          .from(tables.transcripts)
          .where(and(eq(tables.transcripts.assetId, assetId), eq(tables.transcripts.projectId, project.id)))
          .orderBy(desc(tables.transcripts.version))
          .limit(1);
        if (!row) return null;
        return {
          transcriptId: row.id,
          version: row.version,
          assetId: row.assetId,
          language: row.language,
          provider: row.provider,
          model: row.model,
          durationMs: 0,
          text: row.text,
          confidence: row.confidence,
          segments: row.segmentsJson as TranscriptPayload["segments"],
          words: row.wordsJson as TranscriptPayload["words"],
        };
      }),
    readBrandTokens: () =>
      guard("read_brand_tokens", async () => {
        const b = await getBrand(db, org, project.brandId);
        const assets = await db.select().from(tables.brandAssets).where(eq(tables.brandAssets.brandId, project.brandId)).orderBy(desc(tables.brandAssets.createdAt));
        const logo = assets.find((a) => a.type === "logo");
        return {
          brandId: b.row.id,
          name: b.row.name,
          tokens: b.tokens,
          tone: b.tone,
          compliance: b.compliance,
          logoAssetId: (b.tokens.logo.defaultAssetId && assets.some((a) => a.id === b.tokens.logo.defaultAssetId) ? b.tokens.logo.defaultAssetId : logo?.id) ?? null,
          musicAssets: assets.filter((a) => a.type === "music").map((a) => ({ id: a.id, origin: String((a.metadataJson as { origin?: string }).origin ?? ""), durationMs: (a.metadataJson as { durationMs?: number }).durationMs ?? null })),
        };
      }),
    readTemplate: (id) => guard("read_template", async () => getTemplate(id)),
    readArtifact: <T,>(type: Parameters<AgentTools["readArtifact"]>[0]) =>
      guard("read_artifact", async () => {
        const a = await latestArtifact<T>(db, project.id, type);
        return a ? { id: a.id, version: a.version, checksum: a.checksum, payload: a.payload } : null;
      }),
    readEditPlan: (editPlanId) =>
      guard("read_edit_plan", async () => {
        const p = editPlanId ? await getEditPlan(db, project.id, editPlanId) : await latestEditPlan(db, project.id);
        return p ? { id: p.id, version: p.version, plan: p.plan } : null;
      }),
    listReviewComments: () =>
      guard("list_review_comments", async () => {
        const rows = await db
          .select({ c: tables.reviewComments, editPlanId: tables.renders.editPlanId })
          .from(tables.reviewComments)
          .innerJoin(tables.renders, eq(tables.renders.id, tables.reviewComments.renderId))
          .where(eq(tables.reviewComments.projectId, project.id))
          .orderBy(asc(tables.reviewComments.createdAt));
        return rows.map(({ c, editPlanId }) => ({
          id: c.id,
          kind: c.kind as "note" | "cut" | "text_fix" | "remove_motion",
          timecodeMs: c.timecodeMs,
          endTimecodeMs: c.endTimecodeMs,
          replacement: c.replacement,
          body: c.body,
          status: c.status,
          renderId: c.renderId,
          renderEditPlanId: editPlanId,
        }));
      }),
    listApprovals: () =>
      guard("list_approvals", async () => {
        const rows = await db.select().from(tables.approvals).where(eq(tables.approvals.projectId, project.id)).orderBy(desc(tables.approvals.createdAt));
        return rows.map((r) => ({ artifactType: r.artifactType, artifactId: r.artifactId, decision: r.decision as "granted" | "rejected", reason: r.reason, createdAt: r.createdAt.toISOString() }));
      }),
    createArtifact: (type, payload, opts) =>
      guard(
        "create_artifact",
        async () => {
          const row = await createArtifact(db, { projectId: project.id, organizationId: org, type, payload, inputHash: tc.inputHash(), agentRunId: tc.runId, objectKey: opts?.objectKey ?? null, traceId: tc.traceId, actorId: tc.runId });
          return { id: row.id, version: row.version, checksum: row.checksum };
        },
        type,
      ),
    storeProjectFile: (name, source, contentType) =>
      guard(
        "store_project_file",
        async () => {
          const key = projectKey(name);
          if ("path" in source) await storage.putFile(key, source.path, { contentType });
          else await storage.putBuffer(key, Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data), { contentType });
          return key;
        },
        name,
      ),
    validateEditPlan: (payload) =>
      guard("validate_edit_plan", async () => {
        const brand = await getBrand(db, org, project.brandId);
        const refs = await assetRefsFor(db, org, project.id, project.brandId);
        const unknown = collectAssetIds(payload).filter((id) => !refs.has(id));
        if (unknown.length) for (const [k, v] of await assetRefsByIds(db, unknown)) refs.set(k, v);
        return validateEditPlan(payload, { organizationId: org, projectId: project.id, brandId: project.brandId, brandTokens: brand.tokens, assets: refs }).issues;
      }),
    requestHumanApproval: (artifactType, artifactId, reason) =>
      guard("request_human_approval", () => requestApproval(db, { project, artifactType, artifactId, reason, requestedBy: { type: "agent", id: tc.runId } }), artifactType),
    reportBlocker: (code, details) =>
      guard("report_blocker", async () => {
        await emitEvent(db, { organizationId: org, projectId: project.id, actorType: "agent", actorId: tc.runId, eventType: "agent.run.blocked", payload: { agentType: tc.agentType, runId: tc.runId, code, message: details }, traceId: tc.traceId });
      }),
    complianceClearance: () =>
      guard("list_approvals", async () => {
        const rep = await latestArtifact<{ findings: { severity: string; rule: string; text: string }[] }>(db, project.id, "compliance_report");
        if (!rep) return { cleared: false, approvalIds: [], reused: false };
        return complianceClearance(db, project.id, { id: rep.id, payload: rep.payload });
      }),
    readProjectMetrics: () =>
      guard("read_project_metrics", async () => {
        const runs = await db.select().from(tables.agentRuns).where(eq(tables.agentRuns.projectId, project.id));
        const renders = await db.select().from(tables.renders).where(eq(tables.renders.projectId, project.id));
        const transitions = await db.select().from(tables.stateTransitions).where(eq(tables.stateTransitions.projectId, project.id)).orderBy(asc(tables.stateTransitions.id));
        const byAgent: Record<string, number> = {};
        for (const r of runs) if (r.agentType !== "render") byAgent[r.agentType] = (byAgent[r.agentType] ?? 0) + r.costCents;
        const renderCents = renders.reduce((n, r) => n + r.costCents, 0);
        byAgent.render = renderCents;
        const aiCents = runs.filter((r) => r.agentType !== "render").reduce((n, r) => n + r.costCents, 0);
        const byStageMs: Record<string, number> = {};
        for (let i = 0; i < transitions.length; i++) {
          const t = transitions[i]!;
          const next = transitions[i + 1];
          const end = next ? next.createdAt.getTime() : Date.now();
          byStageMs[t.toState] = (byStageMs[t.toState] ?? 0) + (end - t.createdAt.getTime());
        }
        const totalMs = transitions.length ? Date.now() - transitions[0]!.createdAt.getTime() : 0;
        return { aiCents, renderCents, totalCents: aiCents + renderCents, byAgent, byStageMs, totalMs, agents: [...new Set(runs.map((r) => r.agentType))] };
      }),
    // ── restricted ──────────────────────────────────────────
    readOriginalMedia: (assetId) =>
      guard(
        "read_original_media",
        async () => {
          const [a] = await db.select().from(tables.assets).where(and(eq(tables.assets.id, assetId), eq(tables.assets.projectId, project.id)));
          if (!a) throw new Error("asset não encontrado no projeto");
          return storage.materialize(ensureTenantKey(a.objectKey));
        },
        assetId,
      ),
    materialize: (key) => guard("read_artifact", () => storage.materialize(ensureTenantKey(key)), key),
    registerMedia: (assetId, patch) =>
      guard(
        "register_media",
        async () => {
          const [a] = await db.select().from(tables.assets).where(and(eq(tables.assets.id, assetId), eq(tables.assets.projectId, project.id)));
          if (!a) throw new Error("asset não encontrado no projeto");
          const { metadata, codec, ...rest } = patch;
          await db
            .update(tables.assets)
            .set({ ...rest, ...(codec !== undefined ? { codec } : {}), metadataJson: { ...((a.metadataJson ?? {}) as object), ...(metadata ?? {}) } })
            .where(eq(tables.assets.id, assetId));
          const ev = patch.status === "ingesting" ? "asset.ingest.started" : patch.status === "ready" ? "asset.proxy.ready" : patch.status === "failed" || patch.status === "rejected" ? "asset.ingest.failed" : null;
          if (ev)
            await emitEvent(db, { organizationId: org, projectId: project.id, actorType: "agent", actorId: tc.runId, eventType: ev, payload: { assetId, status: patch.status, proxyKey: patch.proxyKey ?? null }, traceId: tc.traceId });
        },
        `${assetId}:${patch.status ?? "update"}`,
      ),
    saveTranscript: (payload, editedBy) =>
      guard(
        "save_transcript",
        async () => {
          const [prev] = await db.select().from(tables.transcripts).where(eq(tables.transcripts.assetId, payload.assetId)).orderBy(desc(tables.transcripts.version)).limit(1);
          const id = newId("transcript");
          const version = (prev?.version ?? 0) + 1;
          await db.insert(tables.transcripts).values({
            id,
            assetId: payload.assetId,
            projectId: project.id,
            version,
            language: payload.language,
            segmentsJson: payload.segments,
            wordsJson: payload.words,
            text: payload.text,
            provider: payload.provider,
            model: payload.model,
            confidence: payload.confidence,
            editedBy: editedBy ?? null,
          });
          await emitEvent(db, {
            organizationId: org,
            projectId: project.id,
            actorType: "agent",
            actorId: tc.runId,
            eventType: editedBy ? "transcript.edited" : "transcript.completed",
            payload: { assetId: payload.assetId, transcriptId: id, version, words: payload.words.length, confidence: payload.confidence, provider: payload.provider },
            traceId: tc.traceId,
          });
          return { transcriptId: id, version };
        },
        payload.assetId,
      ),
    registerGeneratedAsset: (type, localPath, meta) =>
      guard(
        "register_generated_asset",
        async () => {
          const id = newId("asset");
          const key = objectKeys.generatedAudio(org, project.id, `${id}-${meta.originalName}`);
          await storage.putFile(key, localPath, { contentType: "audio/mp4", immutable: true });
          const checksum = await sha256File(localPath);
          await db.insert(tables.assets).values({
            id,
            projectId: project.id,
            organizationId: org,
            type,
            originalName: meta.originalName,
            mimeType: "audio/mp4",
            objectKey: key,
            durationMs: meta.durationMs,
            checksum,
            sizeBytes: (await stat(localPath)).size,
            status: "ready",
            metadataJson: { origin: meta.origin, generatedBy: tc.agentType },
          });
          return id;
        },
        meta.originalName,
      ),
    saveEditPlan: (payload, note) =>
      guard(
        "save_edit_plan",
        async () => {
          const r = await createEditPlanVersion(db, { project, payload, createdByType: "agent", createdById: `agent-${tc.agentType}`, note });
          return { id: r.id, version: r.version, issues: r.issues };
        },
        note,
      ),
    resolveReviewComments: (ids, editPlanId) =>
      guard("resolve_review_comments", async () => {
        if (!ids.length) return;
        await db
          .update(tables.reviewComments)
          .set({ status: "resolved", appliedInEditPlanId: editPlanId })
          .where(and(eq(tables.reviewComments.projectId, project.id), inArray(tables.reviewComments.id, ids)));
        for (const id of ids)
          await emitEvent(db, { organizationId: org, projectId: project.id, actorType: "agent", actorId: tc.runId, eventType: "review.comment.updated", payload: { commentId: id, status: "resolved", appliedInEditPlanId: editPlanId }, traceId: tc.traceId });
      }),
    renderMedia: (kind, editPlanId, onProgress) => guard("render_media", () => renderWithRemotion(tc, kind, editPlanId, onProgress), `${kind}:${editPlanId}`),
  };
  return tools;
}

/** The restricted render tool: Remotion render → (master) loudnorm → probe → checksum → thumbnail. */
async function renderWithRemotion(tc: ToolContext, kind: "preview" | "final", editPlanId: string, onProgress: (f: number) => void): Promise<RenderOutput> {
  const { db, project } = tc;
  const org = project.organizationId;
  const storage = getStorage();
  const ep = await getEditPlan(db, project.id, editPlanId);
  const brand = await getBrand(db, org, project.brandId);
  const renderId = newId("render");
  await db.insert(tables.renders).values({ id: renderId, projectId: project.id, editPlanId, kind, status: "running", startedAt: new Date() });
  const evBase = { organizationId: org, projectId: project.id, actorType: "agent" as const, actorId: tc.runId, traceId: tc.traceId };
  await emitEvent(db, { ...evBase, eventType: kind === "final" ? "render.final.started" : "render.preview.started", payload: { renderId, editPlanId, version: ep.version, agentType: "render", runId: tc.runId } });
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cmf-render-"));
  try {
    // Resolve media: proxies for preview, mezzanines for the master.
    const media: Record<string, LocalMedia> = {};
    const ids = collectAssetIds(ep.plan);
    const assets = ids.length ? await db.select().from(tables.assets).where(inArray(tables.assets.id, ids)) : [];
    for (const a of assets) {
      if (a.organizationId !== org) throw new Error("asset de outra organização na composição");
      const meta = (a.metadataJson ?? {}) as { mezzanineKey?: string | null };
      const key = a.type === "video" ? (kind === "final" ? (meta.mezzanineKey ?? a.proxyKey) : (a.proxyKey ?? meta.mezzanineKey)) : a.objectKey;
      if (!key) throw new Error(`asset ${a.id} sem derivado de mídia (offline)`);
      media[a.id] = { path: await storage.materialize(key), kind: a.type === "video" ? "video" : a.type === "image" ? "image" : "audio" };
    }
    const brandAssets = ids.length ? await db.select().from(tables.brandAssets).where(inArray(tables.brandAssets.id, ids)) : [];
    for (const b of brandAssets) {
      if (b.organizationId !== org) throw new Error("asset de marca de outra organização na composição");
      media[b.id] = { path: await storage.materialize(b.objectKey), kind: b.type === "music" ? "audio" : "image" };
    }
    const fontAssets = await db.select().from(tables.brandAssets).where(and(eq(tables.brandAssets.brandId, project.brandId), eq(tables.brandAssets.type, "font")));
    const brandFonts = [];
    for (const f of fontAssets) {
      const m = (f.metadataJson ?? {}) as { family?: string; weight?: number };
      if (m.family) brandFonts.push({ family: m.family, weight: m.weight ?? 400, style: "normal" as const, path: await storage.materialize(f.objectKey) });
    }
    const rawOut = path.join(tmp, `${kind}-raw.mp4`);
    const scale = kind === "final" ? 1 : 0.5;
    const res = await renderEditPlan({ plan: ep.plan, brand: { name: brand.row.name, tokens: brand.tokens }, media, brandFonts, output: rawOut, scale, onProgress: (f) => onProgress(f * (kind === "final" ? 0.85 : 0.95)) });
    let finalPath = rawOut;
    if (kind === "final") {
      onProgress(0.88);
      finalPath = path.join(tmp, "final.mp4");
      await loudnormMaster(rawOut, finalPath, brand.tokens.audio.targetLufs, brand.tokens.audio.truePeakDb, { timeoutMs: 30 * 60_000 });
    }
    onProgress(0.94);
    const info = await probe(finalPath);
    const checksum = await sha256File(finalPath);
    const size = (await stat(finalPath)).size;
    const loud = info.hasAudio ? await measureLoudness(finalPath) : { integratedLufs: null, truePeakDb: null };
    const thumbPath = path.join(tmp, "thumb.jpg");
    const hook = ep.plan.tracks.find((t) => t.type === "motion")?.items.find((m) => "kind" in m && m.kind === "hook_title");
    const thumbAt = hook ? Math.min(info.durationMs - 100, frameToMs(Math.min(hook.fromFrame + hook.durationInFrames - 10, hook.fromFrame + 45), ep.plan.composition.fps)) : Math.min(1000, info.durationMs / 2);
    await extractStill(finalPath, thumbPath, Math.max(0, thumbAt));
    const key = objectKeys.render(org, project.id, renderId, kind);
    const thumbKey = objectKeys.renderThumb(org, project.id, renderId);
    await storage.putFile(key, finalPath, { contentType: "video/mp4", immutable: true });
    await storage.putFile(thumbKey, thumbPath, { contentType: "image/jpeg" });
    const costCents = (res.renderMs / 60000) * Number(process.env.CMF_RENDER_CENTS_PER_COMPUTE_MINUTE ?? 2);
    await db
      .update(tables.renders)
      .set({
        status: "succeeded",
        objectKey: key,
        thumbnailKey: thumbKey,
        durationMs: info.durationMs,
        width: info.width,
        height: info.height,
        fps: info.fps,
        codec: info.videoCodec,
        fileSize: size,
        checksum,
        costCents,
        progress: 1,
        metricsJson: { renderMs: res.renderMs, framesRendered: res.framesRendered, fpsRendered: res.framesRendered / Math.max(0.001, res.renderMs / 1000), loudness: loud, audioCodec: info.audioCodec },
        finishedAt: new Date(),
      })
      .where(eq(tables.renders.id, renderId));
    await emitEvent(db, {
      ...evBase,
      eventType: kind === "final" ? "render.final.completed" : "render.preview.completed",
      payload: { renderId, editPlanId, version: ep.version, durationMs: info.durationMs, width: info.width, height: info.height, checksum, costCents, agentType: "render", runId: tc.runId },
    });
    return {
      renderId,
      objectKey: key,
      thumbnailKey: thumbKey,
      localPath: await storage.materialize(key),
      durationMs: info.durationMs,
      width: info.width ?? 0,
      height: info.height ?? 0,
      fps: info.fps ?? ep.plan.composition.fps,
      codec: info.videoCodec ?? "unknown",
      audioCodec: info.audioCodec,
      fileSize: size,
      checksum,
      renderMs: res.renderMs,
      framesRendered: res.framesRendered,
      costCents,
      loudness: { integratedLufs: loud.integratedLufs, truePeakDb: loud.truePeakDb },
    };
  } catch (err) {
    await db.update(tables.renders).set({ status: "failed", errorJson: { message: (err as Error).message }, finishedAt: new Date() }).where(eq(tables.renders.id, renderId));
    await emitEvent(db, { ...evBase, eventType: "render.failed", payload: { renderId, kind, message: (err as Error).message.slice(0, 300), agentType: "render", runId: tc.runId } });
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
