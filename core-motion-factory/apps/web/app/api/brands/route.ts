import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { createBrand } from "@cmf/orchestration";
import { CreateBrandRequest } from "@cmf/schemas";
import { actor, body, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("brand.view", async ({ user }) => {
  const rows = await db().select().from(tables.brands).where(eq(tables.brands.organizationId, user.organizationId)).orderBy(desc(tables.brands.updatedAt));
  return rows.map((b) => ({ id: b.id, name: b.name, tokens: b.brandTokensJson, defaultTemplateId: b.defaultTemplateId, updatedAt: b.updatedAt.toISOString() }));
});

export const POST = route("brand.manage", async ({ req, user, requestId }) => {
  const input = await body(req, CreateBrandRequest);
  return ok({ id: await createBrand(db(), actor(user), input) }, requestId, 201);
});
