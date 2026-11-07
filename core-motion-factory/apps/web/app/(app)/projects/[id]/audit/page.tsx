import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getProject, listProjectEvents } from "@cmf/orchestration";
import { Card } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const metadata = { title: "Auditoria" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage("audit.view");
  const p = await getProject(db(), user.organizationId, id);
  const transitions = await db().select().from(tables.stateTransitions).where(eq(tables.stateTransitions.projectId, p.id)).orderBy(asc(tables.stateTransitions.id));
  const approvals = await db().select({ a: tables.approvals, by: tables.users.name }).from(tables.approvals).innerJoin(tables.users, eq(tables.users.id, tables.approvals.decidedBy)).where(eq(tables.approvals.projectId, p.id)).orderBy(asc(tables.approvals.createdAt));
  const events = await listProjectEvents(db(), user.organizationId, p.id, 0, 5000);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="text-sm text-ink-400 hover:text-ink-100">← Sala de produção</Link>
          <h1 className="text-xl font-extrabold">Auditoria · {p.title}</h1>
        </div>
        <div className="flex gap-3 text-sm">
          <a className="text-haxis-400 hover:underline" href={`/api/projects/${p.id}/audit`}>Exportar JSON</a>
          <a className="text-haxis-400 hover:underline" href={`/api/projects/${p.id}/audit?format=csv`}>Exportar CSV</a>
        </div>
      </header>
      <p className="font-mono text-xs text-ink-400">trace_id {p.traceId}</p>
      <Card title={`Transições de estado (${transitions.length})`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-400"><tr><th>Quando</th><th>De → Para</th><th>Autor</th><th>Motivo</th></tr></thead>
          <tbody>{transitions.map((t) => <tr key={t.id} className="border-t border-ink-800"><td className="py-1 tabular-nums">{t.createdAt.toLocaleString("pt-BR")}</td><td>{t.fromState} → {t.toState}</td><td>{t.actorType}:{t.actorId}</td><td className="text-ink-300">{t.reason}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title={`Aprovações humanas (${approvals.length})`}>
        <ul className="text-sm">{approvals.map(({ a, by }) => <li key={a.id} className="border-t border-ink-800 py-1">{a.createdAt.toLocaleString("pt-BR")} · <b>{a.decision === "granted" ? "aprovado" : "reprovado"}</b> {a.artifactType} ({a.artifactId}) por {by} — {a.reason}</li>)}</ul>
      </Card>
      <Card title={`Eventos (${events.length})`}>
        <ol className="max-h-[60vh] overflow-auto font-mono text-[11px]">{events.map((e) => <li key={e.id} className="border-t border-ink-800 py-0.5">#{e.id} {e.createdAt} {e.actorType}:{e.actorId} <span className="text-haxis-400">{e.eventType}</span> {JSON.stringify(e.payload).slice(0, 200)}</li>)}</ol>
      </Card>
    </div>
  );
}
