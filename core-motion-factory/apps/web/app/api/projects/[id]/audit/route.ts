import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject, listProjectEvents } from "@cmf/orchestration";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Exportable audit trail (JSON, or CSV with ?format=csv). */
export const GET = route<{ id: string }>("audit.view", async ({ req, params, user }) => {
  const p = await getProject(db(), user.organizationId, params.id);
  const events = await listProjectEvents(db(), user.organizationId, p.id, 0, 10_000);
  const transitions = await db().select().from(tables.stateTransitions).where(eq(tables.stateTransitions.projectId, p.id)).orderBy(asc(tables.stateTransitions.id));
  const approvals = await db().select().from(tables.approvals).where(eq(tables.approvals.projectId, p.id)).orderBy(asc(tables.approvals.createdAt));
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["id,created_at,actor_type,actor_id,event_type,trace_id,payload", ...events.map((e) => [e.id, e.createdAt, e.actorType, e.actorId, e.eventType, e.traceId, JSON.stringify(e.payload)].map(esc).join(","))];
    return new NextResponse(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="auditoria-${p.id}.csv"` } });
  }
  return {
    projectId: p.id,
    traceId: p.traceId,
    transitions: transitions.map((t) => ({ from: t.fromState, to: t.toState, actorType: t.actorType, actorId: t.actorId, reason: t.reason, at: t.createdAt.toISOString() })),
    approvals: approvals.map((a) => ({ id: a.id, artifactType: a.artifactType, artifactId: a.artifactId, decision: a.decision, reason: a.reason, decidedBy: a.decidedBy, at: a.createdAt.toISOString() })),
    events,
  };
});
