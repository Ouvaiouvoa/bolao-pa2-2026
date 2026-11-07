import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { tables } from "@cmf/db";
import { createProject } from "@cmf/orchestration";
import { CreateProjectRequest, JOB_STATE_LABELS, type JobState } from "@cmf/schemas";
import { actor, body, ok, pageParams, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("project.view", async ({ req, user }) => {
  const { limit, cursor } = pageParams(req);
  const rows = await db()
    .select({ p: tables.projects, brand: tables.brands.name })
    .from(tables.projects)
    .innerJoin(tables.brands, eq(tables.brands.id, tables.projects.brandId))
    .where(and(eq(tables.projects.organizationId, user.organizationId), isNull(tables.projects.deletedAt), cursor ? lt(tables.projects.updatedAt, cursor) : undefined))
    .orderBy(desc(tables.projects.updatedAt))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(({ p, brand }) => ({ id: p.id, title: p.title, status: p.status, statusLabel: JOB_STATE_LABELS[p.status as JobState], brand, channel: p.channel, objective: p.objective, updatedAt: p.updatedAt.toISOString() }));
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.updatedAt : null };
});

export const POST = route("project.create", async ({ req, user, requestId }) => {
  const input = await body(req, CreateProjectRequest);
  const id = await createProject(db(), actor(user), input);
  return ok({ id }, requestId, 201);
});
