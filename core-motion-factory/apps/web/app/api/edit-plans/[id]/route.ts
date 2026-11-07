import { z } from "zod";
import { eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { createEditPlanVersion, getProject } from "@cmf/orchestration";
import { actor, body, HttpError, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const Req = z.strictObject({ payload: z.unknown(), note: z.string().max(300).default("edição manual") });

/** PATCH creates a new version based on the given one (versions are immutable). */
export const PATCH = route<{ id: string }>("timeline.edit", async ({ req, params, user, requestId }) => {
  const input = await body(req, Req);
  const [base] = await db().select().from(tables.editPlans).where(eq(tables.editPlans.id, params.id));
  if (!base) throw new HttpError(404, "NOT_FOUND", "edit plan não encontrado");
  const project = await getProject(db(), user.organizationId, base.projectId);
  const row = await createEditPlanVersion(db(), { project, payload: input.payload, createdByType: "user", createdById: actor(user).id, note: input.note });
  return ok({ id: row.id, version: row.version, issues: row.issues }, requestId, 201);
});

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => {
  const [row] = await db().select().from(tables.editPlans).where(eq(tables.editPlans.id, params.id));
  if (!row) throw new HttpError(404, "NOT_FOUND", "edit plan não encontrado");
  await getProject(db(), user.organizationId, row.projectId);
  return { id: row.id, version: row.version, payload: row.payloadJson, issues: row.issuesJson, createdByType: row.createdByType, note: row.note };
});
