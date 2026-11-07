import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { BrandTokensSchema, can } from "@cmf/schemas";
import { Card, Empty } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Marcas" };

export default async function BrandsPage() {
  const user = await requireUserPage("brand.view");
  const brands = await db().select().from(tables.brands).where(eq(tables.brands.organizationId, user.organizationId)).orderBy(desc(tables.brands.updatedAt));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-extrabold">Marcas e kits de identidade</h1>
        {can(user.role, "brand.manage") && <Link href="/brands/new" className="rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white">+ Nova marca</Link>}
      </header>
      {brands.length === 0 ? (
        <Empty title="Nenhuma marca cadastrada" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => {
            const tk = BrandTokensSchema.parse(b.brandTokensJson);
            return (
              <Link key={b.id} href={`/brands/${b.id}`}>
                <Card title={b.name}>
                  <div className="flex gap-1.5">{Object.values(tk.colors).map((c, i) => <span key={i} className="h-8 flex-1 rounded" style={{ background: c }} />)}</div>
                  <div className="mt-3 text-xs text-ink-400">{tk.typography.heading} · {tk.motion.style} · rodapé “{tk.footer.text}”</div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
