/**
 * Shared driver for the headless pipeline (CLI demo + integration tests).
 * It acts exactly like a human user through the same commands the web API calls:
 * every approval is an explicit Approval record by a named user.
 */
import path from "node:path";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { getDb, runMigrations, tables, type Db } from "@cmf/db";
import {
  createBrand,
  createComment,
  createProject,
  decideApproval,
  getProject,
  latestArtifact,
  openApprovalRequests,
  redisConnectionOptions,
  requestFinalRender,
  requestRevision,
  signupOrganization,
  STAGE_QUEUE,
  startProject,
  uploadLocalFile,
  type StageJobData,
  type UserActor,
} from "@cmf/orchestration";
import { BriefContentSchema, CreateBrandRequest, DEFAULT_BRAND_TOKENS, type JobState } from "@cmf/schemas";
import { runStage } from "../../apps/worker/src/stage-runner";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const FIXTURE = path.join(ROOT, "tests/fixtures/raw-talk-pt.mp4");

export function startInProcessWorker(onError?: (e: Error) => void): Worker<StageJobData> {
  const w = new Worker<StageJobData>(STAGE_QUEUE, async (job) => runStage(job.data, job.attemptsMade), { connection: redisConnectionOptions(), concurrency: 1, lockDuration: 10 * 60_000 });
  w.on("failed", (_job, err) => onError?.(err));
  return w;
}

export async function setupTenant(db: Db = getDb(), suffix = Date.now().toString(36)) {
  await runMigrations();
  const { organizationId, userId } = await signupOrganization(db, { organizationName: `Estúdio Teste ${suffix}`, name: "Diretora de Conteúdo", email: `diretora+${suffix}@example.com`, password: "senha-super-segura-123" });
  const user: UserActor = { id: userId, organizationId, role: "admin" };
  const brandId = await createBrand(db, user, CreateBrandRequest.parse({ name: "HAXIS Core", brandTokens: DEFAULT_BRAND_TOKENS, toneRules: { voice: "direto, didático", hashtags: ["haxiscore", "conteudo"] } }));
  return { user, brandId, organizationId };
}

export async function createFixtureProject(db: Db, user: UserActor, brandId: string, title = "Reel de autoridade — 3 erros") {
  const brief = BriefContentSchema.parse({
    objective: "authority",
    goalStatement: "Mostrar os três erros que fazem a marca perder atenção e clientes em vídeos curtos, e oferecer um modelo de roteiro.",
    channel: "instagram_reels",
    formats: ["9:16"],
    audience: "pequenas e médias empresas que produzem conteúdo",
    keyMessages: ["gancho claro", "público definido", "chamada para ação"],
    keywords: ["gancho", "roteiro", "público", "clientes", "vídeo"],
    cta: { text: "Comente ROTEIRO", url: null },
    durationTargetSec: { min: 20, max: 45 },
    speaker: { name: "Ana Souza", role: "Estrategista de conteúdo" },
  });
  const projectId = await createProject(db, user, { brandId, title, brief, costPolicy: { maxAiCostCents: 200, maxRenderCostCents: 300, maxTotalCostCents: 500, maxRevisionRounds: 3, maxAgentSteps: 120, deadlineAt: null }, aiMode: "deterministic" });
  await uploadLocalFile(db, user, { projectId, purpose: "project_media", fileName: "raw-talk-pt.mp4", mimeType: "video/mp4", path: FIXTURE });
  return projectId;
}

export async function waitForState(db: Db, user: UserActor, projectId: string, states: JobState[], timeoutMs = 15 * 60_000, onTick?: (s: string) => void): Promise<JobState> {
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const p = await getProject(db, user.organizationId, projectId);
    const hold = (p.stageJson as { hold?: { kind: string } | null } | null)?.hold;
    const key = `${p.status}${hold ? `:hold:${hold.kind}` : ""}`;
    if (key !== last) {
      last = key;
      onTick?.(key);
    }
    if (states.includes(p.status as JobState) && !(hold && !states.includes(`${p.status}:hold` as JobState))) return p.status as JobState;
    if (hold) return `${p.status}:hold:${hold.kind}` as JobState;
    if (p.lastError && (p.lastError as { retryable?: boolean }).retryable === false) throw new Error(`pipeline falhou: ${JSON.stringify(p.lastError)}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout aguardando ${states.join("/")} (estado ${p.status})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function approve(db: Db, user: UserActor, projectId: string, type: "brief" | "script" | "render_preview" | "render_master" | "compliance_report", reason = "aprovado") {
  const req = (await openApprovalRequests(db, projectId)).find((r) => r.artifactType === type);
  if (!req) throw new Error(`nenhuma aprovação pendente de ${type}`);
  return decideApproval(db, user, { projectId, artifactType: type, artifactId: req.artifactId, decision: "granted", reason });
}

export async function latestPreview(db: Db, projectId: string) {
  const rows = await db.select().from(tables.renders).where(eq(tables.renders.projectId, projectId));
  return rows.filter((r) => r.kind === "preview" && r.status === "succeeded").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
}

export { createComment, latestArtifact, requestFinalRender, requestRevision, startProject };
