/**
 * Section 24 — integration: upload→ingest→proxy, media→transcription, edit plan→composition,
 * render→QA, comment→new version, approval→master; plus tenant isolation and tool policy.
 * Real Postgres, Redis/BullMQ, FFmpeg, local ASR (Parakeet) and Remotion.
 */
import "./env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Worker } from "bullmq";
import { closeDb, getDb, tables } from "@cmf/db";
import { probe } from "@cmf/media";
import {
  closeRedis,
  createComment,
  createEditPlanVersion,
  decideApproval,
  getProject,
  getStageQueue,
  latestArtifact,
  latestEditPlan,
  NotFoundError,
  requestFinalRender,
  requestRevision,
  ValidationFailedError,
  type StageJobData,
} from "@cmf/orchestration";
import { findTrack, frameToMs, validateEditPlan, DEFAULT_BRAND_TOKENS, type MediaManifest, type QaReport, type TranscriptPayload, type DeliveryPackage } from "@cmf/schemas";
import { getStorage } from "@cmf/storage";
import { ToolPolicyError, createAgentTools } from "../../apps/worker/src/tools";
import { runStage } from "../../apps/worker/src/stage-runner";
import { approve, createFixtureProject, latestPreview, setupTenant, startInProcessWorker, startProject, waitForState, ROOT } from "../support/pipeline";

const db = getDb();
let ctx: Awaited<ReturnType<typeof setupTenant>>;
let projectId: string;
let worker: Worker<StageJobData>;

async function until(states: Parameters<typeof waitForState>[3]) {
  for (;;) {
    const s = await waitForState(db, ctx.user, projectId, states, 12 * 60_000);
    if (!String(s).includes("hold:compliance")) return s;
    await approve(db, ctx.user, projectId, "compliance_report", "revisado pelo jurídico");
  }
}

const NUM: Record<string, string> = { um: "1", uma: "1", dois: "2", tres: "3", três: "3", quatro: "4", cem: "100" };
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/%/g, " por cento")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUM[w] ?? w);

function wer(ref: string[], hyp: string[]): number {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)] as number[]);
  for (let j = 1; j <= hyp.length; j++) d[0]![j] = j;
  for (let i = 1; i <= ref.length; i++)
    for (let j = 1; j <= hyp.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length]![hyp.length]! / ref.length;
}

beforeAll(async () => {
  ctx = await setupTenant(db, "it");
  projectId = await createFixtureProject(db, ctx.user, ctx.brandId, "Integração");
  worker = startInProcessWorker();
});

afterAll(async () => {
  await worker?.close();
  await getStageQueue().close();
  await closeRedis();
  await closeDb();
});

describe.sequential("pipeline real", () => {
  it("upload → ingest → proxy (+ análise de silêncio, cenas, loudness e enquadramento)", async () => {
    await startProject(db, ctx.user, projectId);
    await until(["AWAITING_BRIEF_APPROVAL"]);
    const [asset] = await db.select().from(tables.assets).where(and(eq(tables.assets.projectId, projectId), eq(tables.assets.type, "video")));
    expect(asset!.status).toBe("ready");
    expect(asset!.checksum).toMatch(/^[0-9a-f]{64}$/);
    const proxy = await probe(await getStorage().materialize(asset!.proxyKey!));
    expect([proxy.width, proxy.height, proxy.videoCodec, proxy.fps]).toEqual([1280, 720, "h264", 30]);
    const manifest = (await latestArtifact<MediaManifest>(db, projectId, "media_manifest"))!.payload;
    expect(manifest.silences.length).toBeGreaterThanOrEqual(6);
    expect(manifest.scenes.length).toBeGreaterThanOrEqual(1);
    expect(manifest.framing.segments.length).toBeGreaterThanOrEqual(2);
    const [a, b] = manifest.framing.segments;
    expect(a!.focusX).toBeLessThan(0.45); // presenter on the left in camera A
    expect(b!.focusX).toBeGreaterThan(a!.focusX + 0.1); // moved right in camera B
    expect(manifest.loudness.integratedLufs).toBeLessThan(-15);
  });

  it("mídia → transcrição com timestamps por palavra e precisão medida", async () => {
    const [t] = await db.select().from(tables.transcripts).where(eq(tables.transcripts.projectId, projectId));
    const words = t!.wordsJson as TranscriptPayload["words"];
    for (let i = 1; i < words.length; i++) expect(words[i]!.startMs).toBeGreaterThanOrEqual(words[i - 1]!.startMs);
    expect(t!.confidence).toBeGreaterThan(0.85);
    const ref = JSON.parse(await readFile(path.join(ROOT, "tests/fixtures/raw-talk-pt.script.json"), "utf8")) as { sentences: { text: string }[] };
    const score = wer(norm(ref.sentences.map((s) => s.text).join(" ")), norm(t!.text));
    expect(score).toBeLessThan(0.15);
  });

  it("edit plan → composição válida (marca, áreas seguras, duração do briefing)", async () => {
    await approve(db, ctx.user, projectId, "brief");
    await until(["AWAITING_SCRIPT_APPROVAL"]);
    await approve(db, ctx.user, projectId, "script");
    await until(["IN_REVIEW"]);
    const ep = (await latestEditPlan(db, projectId))!;
    const project = await getProject(db, ctx.user.organizationId, projectId);
    const refs = new Map<string, never>();
    void refs;
    const fps = ep.plan.composition.fps;
    const secs = frameToMs(ep.plan.composition.durationInFrames, fps) / 1000;
    expect(secs).toBeGreaterThanOrEqual(20);
    expect(secs).toBeLessThanOrEqual(45);
    expect(findTrack(ep.plan, "video")!.items.length).toBeGreaterThanOrEqual(6);
    const kinds = findTrack(ep.plan, "motion")!.items.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(["hook_title", "lower_third", "callout", "cta", "progress_bar", "footer"]));
    for (const c of findTrack(ep.plan, "captions")!.items) expect(c.lines.length).toBeLessThanOrEqual(2);
    expect(findTrack(ep.plan, "audio")!.items[0]!.origin).toMatch(/gerada/);
    expect(ep.plan.brandId).toBe(project.brandId);
    const issues = (ep.issuesJson as { severity: string }[]).filter((i) => i.severity === "error");
    expect(issues).toEqual([]);
  });

  it("render → QA técnico do preview", async () => {
    const r = await latestPreview(db, projectId);
    const info = await probe(await getStorage().materialize(r.objectKey!));
    expect([info.width, info.height, info.videoCodec, info.audioCodec]).toEqual([540, 960, "h264", "aac"]);
    expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("comentário → nova versão (corte aplicado pelo Editor, histórico preservado)", async () => {
    const before = (await latestEditPlan(db, projectId))!;
    const preview = await latestPreview(db, projectId);
    const commentId = await createComment(db, ctx.user, preview.id, { timecodeMs: 3000, endTimecodeMs: 4200, kind: "cut", body: "remover", replacement: null, parentId: null });
    await requestRevision(db, ctx.user, projectId, "cortar trecho");
    await until(["IN_REVIEW"]);
    const after = (await latestEditPlan(db, projectId))!;
    expect(after.version).toBeGreaterThan(before.version);
    expect(before.plan.composition.durationInFrames - after.plan.composition.durationInFrames).toBe(36);
    const [c] = await db.select().from(tables.reviewComments).where(eq(tables.reviewComments.id, commentId));
    expect(c!.status).toBe("resolved");
    expect(c!.appliedInEditPlanId).not.toBeNull();
    const versions = await db.select().from(tables.editPlans).where(eq(tables.editPlans.projectId, projectId)).orderBy(asc(tables.editPlans.version));
    expect(versions.length).toBeGreaterThanOrEqual(8);
    const p2 = await latestPreview(db, projectId);
    expect(p2.id).not.toBe(preview.id);
    expect(p2.durationMs!).toBeLessThan(preview.durationMs! - 1000);
  });

  it("aprovação → master, QA e pacote de entrega", async () => {
    await approve(db, ctx.user, projectId, "render_preview");
    await requestFinalRender(db, ctx.user, projectId);
    const end = await until(["READY_TO_DELIVER", "BLOCKED"]);
    const qa = (await latestArtifact<QaReport>(db, projectId, "qa_report"))!.payload;
    expect(end).toBe("READY_TO_DELIVER");
    expect(qa.score).toBeGreaterThanOrEqual(75);
    const [master] = await db.select().from(tables.renders).where(and(eq(tables.renders.projectId, projectId), eq(tables.renders.kind, "final")));
    const info = await probe(await getStorage().materialize(master!.objectKey!));
    expect([info.width, info.height, info.fps, info.videoCodec, info.audioCodec]).toEqual([1080, 1920, 30, "h264", "aac"]);
    const loud = (master!.metricsJson as { loudness: { integratedLufs: number } }).loudness.integratedLufs;
    expect(Math.abs(loud - DEFAULT_BRAND_TOKENS.audio.targetLufs)).toBeLessThan(1.5);
    const pkg = (await latestArtifact<DeliveryPackage>(db, projectId, "delivery_package"))!.payload;
    expect(pkg.files.map((f) => f.name)).toEqual(expect.arrayContaining(["master-1080x1920.mp4", "legendas.srt", "legendas.vtt", "relatorio-qa.json", "pacote-entrega.zip"]));
    expect(pkg.publishing).toBe("not_published");
    await approve(db, ctx.user, projectId, "render_master");
    expect((await getProject(db, ctx.user.organizationId, projectId)).status).toBe("DELIVERED");
    const approvals = await db.select().from(tables.approvals).where(eq(tables.approvals.projectId, projectId));
    expect(new Set(approvals.map((a) => a.artifactType))).toEqual(new Set(["brief", "script", "compliance_report", "render_preview", "render_master"]));
  });
});

describe("isolamento por organização e política de ferramentas", () => {
  it("outra organização não acessa projeto, assets nem aprovações", async () => {
    const other = await setupTenant(db, "it-b");
    await expect(getProject(db, other.organizationId, projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideApproval(db, other.user, { projectId, artifactType: "brief", artifactId: "x", decision: "granted", reason: "" })).rejects.toBeInstanceOf(NotFoundError);
    const otherProject = await createFixtureProject(db, other.user, other.brandId, "Outro tenant");
    const project = await getProject(db, other.organizationId, otherProject);
    const plan = structuredClone((await latestEditPlan(db, projectId))!.plan);
    plan.projectId = otherProject;
    plan.brandId = project.brandId;
    const err = await createEditPlanVersion(db, { project, payload: plan, createdByType: "user", createdById: other.user.id, note: "ataque" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationFailedError);
    expect(JSON.stringify((err as ValidationFailedError).issues)).toMatch(/ASSET_FOREIGN_ORG/);
    const r = validateEditPlan(plan, { organizationId: other.organizationId, brandTokens: DEFAULT_BRAND_TOKENS, assets: new Map() });
    expect(r.ok).toBe(false);
  });

  it("ferramentas restritas são negadas a agentes sem concessão; jobs repetidos são idempotentes", async () => {
    const project = await getProject(db, ctx.user.organizationId, projectId);
    const calls: never[] = [];
    const tools = createAgentTools({ db, project, agentType: "writer", runId: "run_test", inputHash: () => "h", traceId: project.traceId, calls });
    await expect(tools.renderMedia("final", project.currentEditPlanId!, () => undefined)).rejects.toBeInstanceOf(ToolPolicyError);
    await expect(tools.readOriginalMedia("x")).rejects.toBeInstanceOf(ToolPolicyError);
    const res = await runStage({ projectId, organizationId: project.organizationId, stage: "INGESTING", attempt: 1, seq: 1, traceId: project.traceId, reason: "replay", idempotencyKey: "replay" });
    expect(res.status).toBe("stale");
  });
});
