import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getBrand } from "@cmf/orchestration";
import { can } from "@cmf/schemas";
import { getStorage } from "@cmf/storage";
import { TEMPLATES } from "@cmf/templates";
import { BrandForm } from "@/components/brand-form";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Marca" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage("brand.view");
  const b = await getBrand(db(), user.organizationId, id);
  const assets = await db().select().from(tables.brandAssets).where(eq(tables.brandAssets.brandId, id)).orderBy(desc(tables.brandAssets.createdAt));
  const signed = await Promise.all(assets.map(async (a) => ({ id: a.id, type: a.type, url: await getStorage().signedUrl(a.objectKey, { expiresInSec: 3600 }), metadata: a.metadataJson as Record<string, unknown> })));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold">{b.row.name}</h1>
      <BrandForm initial={{ id: b.row.id, name: b.row.name, tokens: b.tokens, tone: b.tone, compliance: b.compliance, defaultTemplateId: b.row.defaultTemplateId, assets: signed }} templates={TEMPLATES} canManage={can(user.role, "brand.manage")} />
    </div>
  );
}
