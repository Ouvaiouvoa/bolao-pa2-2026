import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject } from "@cmf/orchestration";
import { can } from "@cmf/schemas";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("audit.view", async ({ params, user }) => {
  const p = await getProject(db(), user.organizationId, params.id);
  const rows = await db().select().from(tables.agentRuns).where(eq(tables.agentRuns.projectId, p.id)).orderBy(desc(tables.agentRuns.createdAt));
  const cost = can(user.role, "cost.view");
  return rows.map((r) => ({
    id: r.id,
    agentType: r.agentType,
    stage: r.stage,
    status: r.status,
    attempt: r.attempt,
    inputRefs: r.inputRefsJson,
    outputRefs: r.outputRefsJson,
    model: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costCents: cost ? r.costCents : null,
    latencyMs: r.latencyMs,
    traceId: r.traceId,
    error: r.errorJson,
    toolCalls: r.toolCallsJson,
    logs: r.logsJson,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
});
