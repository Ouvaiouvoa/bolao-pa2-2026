import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { createEditPlanVersion, getProject } from "@cmf/orchestration";
import { body, HttpError, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => {
  const p = await getProject(db(), user.organizationId, params.id);
  const rows = await db().select().from(tables.editPlans).where(eq(tables.editPlans.projectId, p.id)).orderBy(desc(tables.editPlans.version));
  return rows.map((r) => ({ id: r.id, version: r.version, schemaVersion: r.schemaVersion, createdByType: r.createdByType, createdById: r.createdById, note: r.note, issues: r.issuesJson, createdAt: r.createdAt.toISOString(), payload: r.payloadJson }));
});

const Req = z.strictObject({ payload: z.unknown(), note: z.string().max(300).default("edição manual"), basedOnVersion: z.number().int().min(1) });

const EDITABLE = ["IN_REVIEW", "REVISION_REQUESTED", "AWAITING_SCRIPT_APPROVAL", "APPROVED", "BLOCKED"];

/** Manual timeline edit → new validated version (history preserved). */
export const POST = route<{ id: string }>("timeline.edit", async ({ req, params, user, requestId }) => {
  const input = await body(req, Req);
  const project = await getProject(db(), user.organizationId, params.id);
  if (!EDITABLE.includes(project.status)) throw new HttpError(409, "LOCKED", `timeline não editável no estado ${project.status}`);
  const [latest] = await db().select({ version: tables.editPlans.version }).from(tables.editPlans).where(eq(tables.editPlans.projectId, project.id)).orderBy(desc(tables.editPlans.version)).limit(1);
  if (latest && latest.version !== input.basedOnVersion) throw new HttpError(409, "VERSION_CONFLICT", `a timeline foi alterada (v${latest.version}); recarregue antes de salvar`);
  const payload = input.payload as Record<string, unknown>;
  if (payload && typeof payload === "object" && payload.metadata && typeof payload.metadata === "object")
    payload.metadata = { ...(payload.metadata as object), createdBy: `user:${user.id}`, createdAt: new Date().toISOString(), basedOnVersion: input.basedOnVersion };
  const row = await createEditPlanVersion(db(), { project, payload, createdByType: "user", createdById: user.id, note: input.note });
  return ok({ id: row.id, version: row.version, issues: row.issues }, requestId, 201);
});
