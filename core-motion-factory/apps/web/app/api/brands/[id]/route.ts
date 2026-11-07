import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getBrand, updateBrand } from "@cmf/orchestration";
import { UpdateBrandRequest } from "@cmf/schemas";
import { getStorage } from "@cmf/storage";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>("brand.view", async ({ params, user }) => {
  const b = await getBrand(db(), user.organizationId, params.id);
  const assets = await db().select().from(tables.brandAssets).where(eq(tables.brandAssets.brandId, b.row.id)).orderBy(desc(tables.brandAssets.createdAt));
  return {
    id: b.row.id,
    name: b.row.name,
    tokens: b.tokens,
    tone: b.tone,
    compliance: b.compliance,
    defaultTemplateId: b.row.defaultTemplateId,
    assets: await Promise.all(assets.map(async (a) => ({ id: a.id, type: a.type, checksum: a.checksum, metadata: a.metadataJson, url: await getStorage().signedUrl(a.objectKey, { expiresInSec: 900 }), createdAt: a.createdAt.toISOString() }))),
  };
});

export const PATCH = route<{ id: string }>("brand.manage", async ({ req, params, user }) => {
  const input = await body(req, UpdateBrandRequest);
  await updateBrand(db(), actor(user), params.id, input);
  return { id: params.id };
});
