import { eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject } from "@cmf/orchestration";
import { getStorage } from "@cmf/storage";
import { HttpError, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => {
  const [r] = await db().select().from(tables.renders).where(eq(tables.renders.id, params.id));
  if (!r) throw new HttpError(404, "NOT_FOUND", "render não encontrado");
  await getProject(db(), user.organizationId, r.projectId);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    editPlanId: r.editPlanId,
    url: r.objectKey && r.status === "succeeded" ? await getStorage().signedUrl(r.objectKey, { expiresInSec: 900 }) : null,
    durationMs: r.durationMs,
    width: r.width,
    height: r.height,
    codec: r.codec,
    fileSize: r.fileSize,
    checksum: r.checksum,
    costCents: user.role === "client" ? null : r.costCents,
    metrics: user.role === "client" ? null : r.metricsJson,
    error: r.errorJson,
  };
});
