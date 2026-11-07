import { eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject } from "@cmf/orchestration";
import { getStorage } from "@cmf/storage";
import { HttpError, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("project.view", async ({ params, user }) => {
  const [a] = await db().select().from(tables.assets).where(eq(tables.assets.id, params.id));
  if (!a || a.organizationId !== user.organizationId) throw new HttpError(404, "NOT_FOUND", "asset não encontrado");
  await getProject(db(), user.organizationId, a.projectId);
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    originalName: a.originalName,
    mimeType: a.mimeType,
    durationMs: a.durationMs,
    width: a.width,
    height: a.height,
    fps: a.fps,
    codec: a.codec,
    sizeBytes: a.sizeBytes,
    checksum: a.checksum,
    proxyUrl: a.proxyKey ? await getStorage().signedUrl(a.proxyKey, { expiresInSec: 900 }) : null,
    metadata: a.metadataJson,
  };
});
