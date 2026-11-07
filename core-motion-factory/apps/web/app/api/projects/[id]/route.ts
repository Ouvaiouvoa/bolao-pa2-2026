import { eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { emitEvent, getProject } from "@cmf/orchestration";
import { UpdateProjectRequest } from "@cmf/schemas";
import { isSelectable } from "@cmf/templates";
import { body, HttpError, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { loadProjectSnapshot } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => loadProjectSnapshot(user, params.id));

export const PATCH = route<{ id: string }>("project.update", async ({ req, params, user }) => {
  const input = await body(req, UpdateProjectRequest);
  const p = await getProject(db(), user.organizationId, params.id);
  if (input.templateId && !isSelectable(input.templateId)) throw new HttpError(422, "TEMPLATE_UNAVAILABLE", "template indisponível");
  if (input.templateId && !["DRAFT", "ASSETS_UPLOADING", "AWAITING_BRIEF_APPROVAL"].includes(p.status)) throw new HttpError(409, "LOCKED", "template não pode mudar após a aprovação do briefing");
  if (input.costPolicy && user.role !== "admin" && user.role !== "director") throw new HttpError(403, "FORBIDDEN", "apenas diretor/admin altera limites de custo");
  await db()
    .update(tables.projects)
    .set({ ...(input.title ? { title: input.title } : {}), ...(input.templateId ? { templateId: input.templateId } : {}), ...(input.costPolicy ? { costPolicyJson: input.costPolicy } : {}), updatedAt: new Date() })
    .where(eq(tables.projects.id, p.id));
  await emitEvent(db(), { organizationId: user.organizationId, projectId: p.id, actorType: "user", actorId: user.id, eventType: "project.updated", payload: { fields: Object.keys(input) }, traceId: p.traceId });
  return { id: p.id };
});
