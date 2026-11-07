import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import {
  ARTIFACT_SCHEMAS,
  BrandTokensSchema,
  BriefContentSchema,
  ComplianceRulesSchema,
  CostPolicySchema,
  newId,
  ToneRulesSchema,
  validateEditPlan,
  type ArtifactType,
  type AssetRef,
  type BrandTokens,
  type BriefContent,
  type ComplianceRules,
  type CostPolicy,
  type CostSnapshot,
  type EditPlan,
  type EditPlanIssue,
  type ToneRules,
} from "@cmf/schemas";
import { emitEvent } from "./events";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} não encontrado`);
    this.name = "NotFoundError";
  }
}

export class ValidationFailedError extends Error {
  constructor(message: string, readonly issues: EditPlanIssue[] | { path: string; message: string }[]) {
    super(message);
    this.name = "ValidationFailedError";
  }
}

export function stableHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canonical((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export type ProjectRow = typeof tables.projects.$inferSelect;
export type BrandRow = typeof tables.brands.$inferSelect;

export async function getProject(db: Db, organizationId: string, projectId: string): Promise<ProjectRow> {
  const [row] = await db
    .select()
    .from(tables.projects)
    .where(and(eq(tables.projects.id, projectId), eq(tables.projects.organizationId, organizationId), isNull(tables.projects.deletedAt)));
  if (!row) throw new NotFoundError("projeto");
  return row;
}

export function projectCostPolicy(project: ProjectRow): CostPolicy {
  return CostPolicySchema.parse(project.costPolicyJson ?? {});
}

export interface ResolvedBrand {
  row: BrandRow;
  tokens: BrandTokens;
  tone: ToneRules;
  compliance: ComplianceRules;
}

export async function getBrand(db: Db, organizationId: string, brandId: string): Promise<ResolvedBrand> {
  const [row] = await db.select().from(tables.brands).where(and(eq(tables.brands.id, brandId), eq(tables.brands.organizationId, organizationId)));
  if (!row) throw new NotFoundError("marca");
  return {
    row,
    tokens: BrandTokensSchema.parse(row.brandTokensJson),
    tone: ToneRulesSchema.parse(row.toneRulesJson),
    compliance: ComplianceRulesSchema.parse(row.complianceRulesJson),
  };
}

export async function latestBrief(db: Db, projectId: string): Promise<{ row: typeof tables.briefs.$inferSelect; content: BriefContent }> {
  const [row] = await db.select().from(tables.briefs).where(eq(tables.briefs.projectId, projectId)).orderBy(desc(tables.briefs.version)).limit(1);
  if (!row) throw new NotFoundError("briefing");
  return { row, content: BriefContentSchema.parse(row.contentJson) };
}

export type ArtifactRow = typeof tables.artifacts.$inferSelect;

export async function latestArtifact<T = unknown>(db: Db, projectId: string, type: ArtifactType): Promise<(ArtifactRow & { payload: T }) | null> {
  const [row] = await db
    .select()
    .from(tables.artifacts)
    .where(and(eq(tables.artifacts.projectId, projectId), eq(tables.artifacts.type, type)))
    .orderBy(desc(tables.artifacts.version))
    .limit(1);
  return row ? { ...row, payload: row.payloadJson as T } : null;
}

export async function artifactsByType<T = unknown>(db: Db, projectId: string, type: ArtifactType): Promise<(ArtifactRow & { payload: T })[]> {
  const rows = await db
    .select()
    .from(tables.artifacts)
    .where(and(eq(tables.artifacts.projectId, projectId), eq(tables.artifacts.type, type)))
    .orderBy(desc(tables.artifacts.version));
  return rows.map((r) => ({ ...r, payload: r.payloadJson as T }));
}

/** Validates (when a schema exists) and persists an artifact with an incrementing version. */
export async function createArtifact(
  db: Db,
  input: { projectId: string; organizationId: string; type: ArtifactType; payload: unknown; inputHash: string; agentRunId?: string | null; objectKey?: string | null; traceId?: string | null; actorId?: string },
): Promise<ArtifactRow> {
  const schema = ARTIFACT_SCHEMAS[input.type];
  let payload = input.payload;
  if (schema) {
    const parsed = schema.safeParse(input.payload);
    if (!parsed.success) {
      throw new ValidationFailedError(
        `artefato ${input.type} inválido`,
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    payload = parsed.data;
  }
  const json = JSON.stringify(payload);
  const checksum = createHash("sha256").update(json).digest("hex");
  const row = await db.transaction(async (trx) => {
    const [{ maxVersion }] = (await trx
      .select({ maxVersion: sql<number>`coalesce(max(${tables.artifacts.version}), 0)` })
      .from(tables.artifacts)
      .where(and(eq(tables.artifacts.projectId, input.projectId), eq(tables.artifacts.type, input.type)))) as [{ maxVersion: number }];
    const [inserted] = await trx
      .insert(tables.artifacts)
      .values({
        id: newId("artifact"),
        projectId: input.projectId,
        organizationId: input.organizationId,
        type: input.type,
        version: Number(maxVersion) + 1,
        payloadJson: payload as object,
        objectKey: input.objectKey ?? null,
        checksum,
        inputHash: input.inputHash,
        agentRunId: input.agentRunId ?? null,
      })
      .returning();
    return inserted!;
  });
  await emitEvent(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    actorType: input.agentRunId ? "agent" : "user",
    actorId: input.actorId ?? input.agentRunId ?? "system",
    eventType: "agent.artifact.created",
    payload: { artifactId: row.id, type: input.type, version: row.version, checksum, agentRunId: input.agentRunId ?? null },
    traceId: input.traceId ?? null,
  });
  return row;
}

export async function listProjectAssets(db: Db, projectId: string) {
  return db.select().from(tables.assets).where(eq(tables.assets.projectId, projectId)).orderBy(tables.assets.createdAt);
}

/** Every asset an edit plan of this project may reference (project assets + brand assets). */
export async function assetRefsFor(db: Db, organizationId: string, projectId: string, brandId: string): Promise<Map<string, AssetRef>> {
  const map = new Map<string, AssetRef>();
  const assets = await db.select().from(tables.assets).where(eq(tables.assets.projectId, projectId));
  for (const a of assets) {
    map.set(a.id, {
      id: a.id,
      organizationId: a.organizationId,
      kind: (a.type === "music" ? "music" : a.type) as AssetRef["kind"],
      durationMs: a.durationMs,
    });
  }
  const brandAssets = await db.select().from(tables.brandAssets).where(eq(tables.brandAssets.brandId, brandId));
  for (const b of brandAssets) {
    const meta = (b.metadataJson ?? {}) as { durationMs?: number };
    map.set(b.id, { id: b.id, organizationId: b.organizationId, kind: b.type as AssetRef["kind"], durationMs: meta.durationMs ?? null });
  }
  return map;
}

/** Same lookup, but for any asset ids (used to detect cross-tenant references). */
export async function assetRefsByIds(db: Db, ids: string[]): Promise<Map<string, AssetRef>> {
  const map = new Map<string, AssetRef>();
  if (!ids.length) return map;
  const rows = await db.select().from(tables.assets).where(inArray(tables.assets.id, ids));
  for (const a of rows) map.set(a.id, { id: a.id, organizationId: a.organizationId, kind: a.type as AssetRef["kind"], durationMs: a.durationMs });
  const brandRows = await db.select().from(tables.brandAssets).where(inArray(tables.brandAssets.id, ids));
  for (const b of brandRows) map.set(b.id, { id: b.id, organizationId: b.organizationId, kind: b.type as AssetRef["kind"], durationMs: null });
  return map;
}

export type EditPlanRow = typeof tables.editPlans.$inferSelect;

export async function latestEditPlan(db: Db, projectId: string): Promise<(EditPlanRow & { plan: EditPlan }) | null> {
  const [row] = await db.select().from(tables.editPlans).where(eq(tables.editPlans.projectId, projectId)).orderBy(desc(tables.editPlans.version)).limit(1);
  return row ? { ...row, plan: row.payloadJson as EditPlan } : null;
}

export async function getEditPlan(db: Db, projectId: string, editPlanId: string): Promise<EditPlanRow & { plan: EditPlan }> {
  const [row] = await db.select().from(tables.editPlans).where(and(eq(tables.editPlans.id, editPlanId), eq(tables.editPlans.projectId, projectId)));
  if (!row) throw new NotFoundError("edit plan");
  return { ...row, plan: row.payloadJson as EditPlan };
}

/**
 * The only way an edit plan reaches the database: full validation (schema + brand + tenant
 * + safe areas). Versions are immutable; editing creates a new version (history preserved).
 */
export async function createEditPlanVersion(
  db: Db,
  input: { project: ProjectRow; payload: unknown; createdByType: "agent" | "user"; createdById: string; note: string },
): Promise<EditPlanRow & { plan: EditPlan; issues: EditPlanIssue[] }> {
  const brand = await getBrand(db, input.project.organizationId, input.project.brandId);
  const refs = await assetRefsFor(db, input.project.organizationId, input.project.id, input.project.brandId);
  // Also resolve ids not found in this project to detect foreign-organization references explicitly.
  const referenced = collectAssetIds(input.payload);
  const unknown = referenced.filter((id) => !refs.has(id));
  if (unknown.length) for (const [k, v] of await assetRefsByIds(db, unknown)) refs.set(k, v);
  const result = validateEditPlan(input.payload, {
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    brandId: input.project.brandId,
    brandTokens: brand.tokens,
    assets: refs,
  });
  if (!result.ok || !result.plan) throw new ValidationFailedError("edit plan inválido", result.issues);
  const plan = result.plan;
  const row = await db.transaction(async (trx) => {
    const [{ maxVersion }] = (await trx
      .select({ maxVersion: sql<number>`coalesce(max(${tables.editPlans.version}), 0)` })
      .from(tables.editPlans)
      .where(eq(tables.editPlans.projectId, input.project.id))) as [{ maxVersion: number }];
    const [inserted] = await trx
      .insert(tables.editPlans)
      .values({
        id: newId("editPlan"),
        projectId: input.project.id,
        version: Number(maxVersion) + 1,
        schemaVersion: plan.schemaVersion,
        payloadJson: plan,
        issuesJson: result.issues,
        createdByType: input.createdByType,
        createdById: input.createdById,
        note: input.note,
      })
      .returning();
    await trx.update(tables.projects).set({ currentEditPlanId: inserted!.id, updatedAt: new Date() }).where(eq(tables.projects.id, input.project.id));
    return inserted!;
  });
  await emitEvent(db, {
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    actorType: input.createdByType,
    actorId: input.createdById,
    eventType: "edit_plan.version.created",
    payload: { editPlanId: row.id, version: row.version, warnings: result.issues.length, note: input.note },
    traceId: input.project.traceId,
  });
  return { ...row, plan, issues: result.issues };
}

export function collectAssetIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "assetId" && typeof val === "string") ids.add(val);
        else walk(val);
      }
    }
  };
  walk(payload);
  return [...ids];
}

/** Actual spend so far (section 22). */
export async function spendSnapshot(db: Db, projectId: string): Promise<CostSnapshot> {
  const [runs] = (await db
    .select({
      ai: sql<number>`coalesce(sum(case when ${tables.agentRuns.agentType} <> 'render' then ${tables.agentRuns.costCents} else 0 end), 0)`,
      steps: sql<number>`count(*) filter (where ${tables.agentRuns.status} in ('succeeded','failed','running','blocked'))`,
    })
    .from(tables.agentRuns)
    .where(eq(tables.agentRuns.projectId, projectId))) as [{ ai: number; steps: number }];
  const [renders] = (await db
    .select({ render: sql<number>`coalesce(sum(${tables.renders.costCents}), 0)` })
    .from(tables.renders)
    .where(eq(tables.renders.projectId, projectId))) as [{ render: number }];
  const [project] = await db.select({ rounds: tables.projects.revisionRound }).from(tables.projects).where(eq(tables.projects.id, projectId));
  const ai = Number(runs.ai);
  const render = Number(renders.render);
  return { aiCents: ai, renderCents: render, totalCents: ai + render, agentSteps: Number(runs.steps), revisionRounds: project?.rounds ?? 0 };
}

const normFinding = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

/**
 * Whether a compliance report's high-severity findings are covered by explicit human decisions.
 * A decision on report A also covers report B only when every high finding of B is identical
 * (rule + text) to one decided in A — new findings always need a new human decision.
 */
export async function complianceClearance(
  db: Db,
  projectId: string,
  report: { id: string; payload: { findings: { severity: string; rule: string; text: string }[] } },
): Promise<{ cleared: boolean; approvalIds: string[]; reused: boolean }> {
  const high = report.payload.findings.filter((f) => f.severity === "high");
  const granted = await db
    .select()
    .from(tables.approvals)
    .where(and(eq(tables.approvals.projectId, projectId), eq(tables.approvals.artifactType, "compliance_report"), eq(tables.approvals.decision, "granted")));
  const direct = granted.filter((a) => a.artifactId === report.id);
  if (direct.length || !high.length) return { cleared: true, approvalIds: direct.map((a) => a.id), reused: false };
  if (!granted.length) return { cleared: false, approvalIds: [], reused: false };
  const prior = await db.select().from(tables.artifacts).where(inArray(tables.artifacts.id, granted.map((a) => a.artifactId)));
  const covered = new Set<string>();
  for (const p of prior)
    for (const f of (p.payloadJson as { findings?: { severity: string; rule: string; text: string }[] }).findings ?? [])
      if (f.severity === "high") covered.add(`${f.rule}|${normFinding(f.text)}`);
  const ok = high.every((f) => covered.has(`${f.rule}|${normFinding(f.text)}`));
  return ok ? { cleared: true, approvalIds: granted.map((a) => a.id), reused: true } : { cleared: false, approvalIds: [], reused: false };
}
