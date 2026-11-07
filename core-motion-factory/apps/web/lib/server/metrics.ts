import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getStageQueue } from "@cmf/orchestration";
import { JOB_STATE_LABELS, type JobState } from "@cmf/schemas";
import { TEMPLATES } from "@cmf/templates";
import { db } from "./db";

/** Section 13.1 — Command Center aggregates (all scoped to the organization). */
export async function commandCenter(orgId: string) {
  const d = db();
  const projects = await d
    .select({ p: tables.projects, brand: tables.brands.name })
    .from(tables.projects)
    .innerJoin(tables.brands, eq(tables.brands.id, tables.projects.brandId))
    .where(and(eq(tables.projects.organizationId, orgId), isNull(tables.projects.deletedAt)))
    .orderBy(desc(tables.projects.updatedAt));
  const running = await d
    .select({ r: tables.agentRuns, title: tables.projects.title })
    .from(tables.agentRuns)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.agentRuns.projectId))
    .where(and(eq(tables.agentRuns.organizationId, orgId), eq(tables.agentRuns.status, "running")));
  const approvals = await d
    .select({ a: tables.approvalRequests, title: tables.projects.title })
    .from(tables.approvalRequests)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.approvalRequests.projectId))
    .where(and(eq(tables.approvalRequests.organizationId, orgId), eq(tables.approvalRequests.status, "open")))
    .orderBy(desc(tables.approvalRequests.createdAt));
  const delivered = projects.filter(({ p }) => p.status === "DELIVERED");
  const deliveredIds = delivered.map(({ p }) => p.id);
  let costPerDelivery: number | null = null;
  let finalMinutes = 0;
  if (deliveredIds.length) {
    const [ai] = (await d.select({ v: sql<number>`coalesce(sum(case when ${tables.agentRuns.agentType} <> 'render' then ${tables.agentRuns.costCents} else 0 end),0)` }).from(tables.agentRuns).where(inArray(tables.agentRuns.projectId, deliveredIds))) as [{ v: number }];
    const [rc] = (await d.select({ v: sql<number>`coalesce(sum(${tables.renders.costCents}),0)` }).from(tables.renders).where(inArray(tables.renders.projectId, deliveredIds))) as [{ v: number }];
    costPerDelivery = (Number(ai.v) + Number(rc.v)) / deliveredIds.length;
    const finals = await d.select({ ms: tables.renders.durationMs, pid: tables.renders.projectId }).from(tables.renders).where(and(inArray(tables.renders.projectId, deliveredIds), eq(tables.renders.kind, "final"), eq(tables.renders.status, "succeeded")));
    const lastByProject = new Map<string, number>();
    for (const f of finals) lastByProject.set(f.pid, f.ms ?? 0);
    finalMinutes = [...lastByProject.values()].reduce((n, v) => n + v, 0) / 60000;
  }
  // Measured production time per delivered video (first transition → DELIVERED).
  let avgProductionMin: number | null = null;
  if (deliveredIds.length) {
    const rows = await d
      .select({ pid: tables.stateTransitions.projectId, first: sql<Date>`min(${tables.stateTransitions.createdAt})`, last: sql<Date>`max(${tables.stateTransitions.createdAt})` })
      .from(tables.stateTransitions)
      .where(inArray(tables.stateTransitions.projectId, deliveredIds))
      .groupBy(tables.stateTransitions.projectId);
    avgProductionMin = rows.reduce((n, r) => n + (new Date(r.last).getTime() - new Date(r.first).getTime()), 0) / rows.length / 60000;
  }
  const [org] = await d.select().from(tables.organizations).where(eq(tables.organizations.id, orgId));
  const baseline = (org?.settingsJson as { baselineManualMinutesPerVideo?: number | null })?.baselineManualMinutesPerVideo ?? null;
  let queue = null;
  try {
    queue = await getStageQueue().counts();
  } catch {
    queue = null;
  }
  const blocked = projects.filter(({ p }) => p.status === "BLOCKED" || p.lastError || (p.stageJson as { hold?: unknown } | null)?.hold);
  return {
    activeProjects: projects.filter(({ p }) => p.status !== "DELIVERED").map(({ p, brand }) => ({ id: p.id, title: p.title, status: p.status as JobState, statusLabel: JOB_STATE_LABELS[p.status as JobState], brand, updatedAt: p.updatedAt.toISOString() })),
    runningJobs: running.map(({ r, title }) => ({ id: r.id, projectId: r.projectId, projectTitle: title, agentType: r.agentType, stage: r.stage, progress: r.progress, task: r.currentTask })),
    pendingApprovals: approvals.map(({ a, title }) => ({ id: a.id, projectId: a.projectId, projectTitle: title, artifactType: a.artifactType, reason: a.reason, createdAt: a.createdAt.toISOString() })),
    failures: blocked.map(({ p }) => ({ id: p.id, title: p.title, status: p.status, error: (p.lastError as { message?: string } | null)?.message ?? (p.stageJson as { hold?: { message?: string } } | null)?.hold?.message ?? "QA bloqueou a entrega" })),
    volume: { delivered: delivered.length, finalMinutes, total: projects.length },
    costPerDeliveryCents: costPerDelivery,
    time: { avgProductionMin, baselineManualMinutesPerVideo: baseline, estimatedSavedMinutes: baseline !== null && avgProductionMin !== null ? Math.max(0, baseline - avgProductionMin) * delivered.length : null },
    queue: queue ? { ...queue, workerConcurrency: Number(process.env.CMF_WORKER_CONCURRENCY ?? 2) } : null,
  };
}

/** Section 13.7 — Analytics. */
export async function analytics(orgId: string) {
  const d = db();
  const projects = await d.select().from(tables.projects).where(and(eq(tables.projects.organizationId, orgId), isNull(tables.projects.deletedAt)));
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { empty: true as const };
  const transitions = await d.select().from(tables.stateTransitions).where(inArray(tables.stateTransitions.projectId, ids)).orderBy(tables.stateTransitions.projectId, tables.stateTransitions.id);
  const stageTotals: Record<string, { ms: number; n: number }> = {};
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i]!;
    const next = transitions[i + 1];
    if (!next || next.projectId !== t.projectId) continue;
    const ms = next.createdAt.getTime() - t.createdAt.getTime();
    const s = (stageTotals[t.toState] ??= { ms: 0, n: 0 });
    s.ms += ms;
    s.n++;
  }
  const timePerStage = Object.entries(stageTotals).map(([stage, v]) => ({ stage, label: JOB_STATE_LABELS[stage as JobState] ?? stage, avgMs: v.ms / v.n, samples: v.n }));
  const approvals = await d.select().from(tables.approvals).where(inArray(tables.approvals.projectId, ids));
  const previewDecided = new Map<string, string[]>();
  for (const a of approvals.filter((x) => x.artifactType === "render_preview").sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) previewDecided.set(a.projectId, [...(previewDecided.get(a.projectId) ?? []), a.decision]);
  const reviewedProjects = projects.filter((p) => previewDecided.has(p.id) || p.revisionRound > 0);
  const firstVersionApproved = reviewedProjects.filter((p) => p.revisionRound === 0 && previewDecided.get(p.id)?.[0] === "granted").length;
  const runs = await d.select().from(tables.agentRuns).where(inArray(tables.agentRuns.projectId, ids));
  const renders = await d.select().from(tables.renders).where(inArray(tables.renders.projectId, ids));
  const failuresByAgent: Record<string, { failed: number; total: number; avgLatencyMs: number; costCents: number }> = {};
  for (const r of runs) {
    const f = (failuresByAgent[r.agentType] ??= { failed: 0, total: 0, avgLatencyMs: 0, costCents: 0 });
    f.total++;
    if (r.status === "failed") f.failed++;
    f.avgLatencyMs += r.latencyMs ?? 0;
    f.costCents += r.costCents;
  }
  for (const f of Object.values(failuresByAgent)) f.avgLatencyMs = f.avgLatencyMs / Math.max(1, f.total);
  const finals = renders.filter((r) => r.kind === "final" && r.status === "succeeded");
  const totalCost = runs.filter((r) => r.agentType !== "render").reduce((n, r) => n + r.costCents, 0) + renders.reduce((n, r) => n + r.costCents, 0);
  const finalMinutes = finals.reduce((n, r) => n + (r.durationMs ?? 0), 0) / 60000;
  const templateUsage = TEMPLATES.map((t) => ({ id: t.id, name: t.name, status: t.status, projects: projects.filter((p) => p.templateId === t.id).length }));
  const brands = await d.select().from(tables.brands).where(eq(tables.brands.organizationId, orgId));
  const volumeByBrand = brands.map((b) => ({ brand: b.name, projects: projects.filter((p) => p.brandId === b.id).length, delivered: projects.filter((p) => p.brandId === b.id && p.status === "DELIVERED").length }));
  const [org] = await d.select().from(tables.organizations).where(eq(tables.organizations.id, orgId));
  const baseline = (org?.settingsJson as { baselineManualMinutesPerVideo?: number | null })?.baselineManualMinutesPerVideo ?? null;
  return {
    empty: false as const,
    timePerStage,
    firstVersionApprovalRate: reviewedProjects.length ? firstVersionApproved / reviewedProjects.length : null,
    reworkAvgRounds: projects.length ? projects.reduce((n, p) => n + p.revisionRound, 0) / projects.length : 0,
    costPerFinalMinuteCents: finalMinutes > 0 ? totalCost / finalMinutes : null,
    failuresByAgent,
    templateUsage,
    volumeByBrand,
    cachedRuns: runs.filter((r) => r.status === "cached").length,
    humanInterventions: approvals.length,
    baselineManualMinutesPerVideo: baseline,
  };
}
