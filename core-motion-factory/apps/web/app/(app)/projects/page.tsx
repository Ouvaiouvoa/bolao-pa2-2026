import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { tables } from "@cmf/db";
import { CHANNEL_LABELS, OBJECTIVE_LABELS, type Channel, type JobState, type Objective } from "@cmf/schemas";
import { StateBadge } from "@/components/state-badge";
import { Card, Empty } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Projetos" };

export default async function ProjectsPage() {
  const user = await requireUserPage("project.view");
  const rows = await db()
    .select({ p: tables.projects, brand: tables.brands.name })
    .from(tables.projects)
    .innerJoin(tables.brands, eq(tables.brands.id, tables.projects.brandId))
    .where(and(eq(tables.projects.organizationId, user.organizationId), isNull(tables.projects.deletedAt)))
    .orderBy(desc(tables.projects.updatedAt))
    .limit(200);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-extrabold">Projetos</h1>
        <Link href="/projects/new" className="rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white hover:bg-haxis-400">+ Novo projeto</Link>
      </header>
      <Card>
        {rows.length === 0 ? (
          <Empty title="Nenhum projeto ainda" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400 uppercase">
              <tr><th className="py-2">Projeto</th><th>Marca</th><th>Objetivo</th><th>Canal</th><th>Estado</th><th className="text-right">Atualizado</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {rows.map(({ p, brand }) => (
                <tr key={p.id}>
                  <td className="py-2.5"><Link className="font-semibold hover:text-haxis-400" href={`/projects/${p.id}`}>{p.title}</Link></td>
                  <td className="text-ink-300">{brand}</td>
                  <td className="text-ink-300">{OBJECTIVE_LABELS[p.objective as Objective] ?? p.objective}</td>
                  <td className="text-ink-300">{CHANNEL_LABELS[p.channel as Channel] ?? p.channel}</td>
                  <td><StateBadge state={p.status as JobState} hold={Boolean((p.stageJson as { hold?: unknown } | null)?.hold)} /></td>
                  <td className="text-right text-ink-400 tabular-nums">{p.updatedAt.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
