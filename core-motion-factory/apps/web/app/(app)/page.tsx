import Link from "next/link";
import { AGENTS, type AgentType } from "@cmf/schemas";
import { StateBadge } from "@/components/state-badge";
import { Badge, Card, cents, Empty, Progress, Stat } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";
import { commandCenter } from "@/lib/server/metrics";

export const metadata = { title: "Command Center" };

const APPROVAL_LABEL: Record<string, string> = { brief: "Briefing", script: "Roteiro", render_preview: "Preview", render_master: "Master", compliance_report: "Compliance", budget: "Orçamento" };

export default async function CommandCenterPage() {
  const user = await requireUserPage("project.view");
  const cc = await commandCenter(user.organizationId);
  const showCost = user.role !== "client";
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">Command Center</h1>
          <p className="text-sm text-ink-400">Produção em andamento, aprovações e bloqueios — dados reais da fila e do banco.</p>
        </div>
        <Link href="/projects/new" className="rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white hover:bg-haxis-400">
          + Novo projeto
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Projetos ativos" value={cc.activeProjects.length} hint={`${cc.volume.total} no total`} />
        <Stat label="Entregues" value={cc.volume.delivered} hint={`${cc.volume.finalMinutes.toFixed(1)} min de vídeo final`} />
        {showCost && <Stat label="Custo por entrega" value={cents(cc.costPerDeliveryCents)} hint="IA + render, média por vídeo entregue" />}
        <Stat
          label="Tempo de produção"
          value={cc.time.avgProductionMin !== null ? `${cc.time.avgProductionMin.toFixed(0)} min` : "—"}
          hint={
            cc.time.baselineManualMinutesPerVideo !== null
              ? `economia estimada: ${(cc.time.estimatedSavedMinutes ?? 0).toFixed(0)} min (linha de base ${cc.time.baselineManualMinutesPerVideo} min/vídeo)`
              : "economia só é exibida após medir a linha de base (Configurações)"
          }
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Aprovações pendentes (${cc.pendingApprovals.length})`} className="lg:col-span-2">
          {cc.pendingApprovals.length === 0 ? (
            <Empty title="Nenhuma aprovação aguardando decisão humana" />
          ) : (
            <ul className="divide-y divide-ink-700">
              {cc.pendingApprovals.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={a.artifactType.startsWith("render") ? `/projects/${a.projectId}/review` : `/projects/${a.projectId}`} className="font-semibold hover:text-haxis-400">
                      {a.projectTitle}
                    </Link>
                    <div className="truncate text-xs text-ink-400">{a.reason}</div>
                  </div>
                  <Badge tone="warn">{APPROVAL_LABEL[a.artifactType] ?? a.artifactType}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Fila de execução">
          {cc.queue ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-ink-400">Ativos</dt><dd className="text-lg font-bold">{cc.queue.active}</dd></div>
              <div><dt className="text-ink-400">Aguardando</dt><dd className="text-lg font-bold">{cc.queue.waiting + cc.queue.delayed}</dd></div>
              <div><dt className="text-ink-400">Falhas</dt><dd className="text-lg font-bold">{cc.queue.failed}</dd></div>
              <div><dt className="text-ink-400">Capacidade</dt><dd className="text-lg font-bold">{cc.queue.workerConcurrency}/worker</dd></div>
            </dl>
          ) : (
            <Empty title="Fila indisponível">Verifique REDIS_URL e o worker.</Empty>
          )}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Agentes trabalhando (${cc.runningJobs.length})`}>
          {cc.runningJobs.length === 0 ? (
            <Empty title="Nenhum agente em execução agora" />
          ) : (
            <ul className="flex flex-col gap-3">
              {cc.runningJobs.map((j) => (
                <li key={j.id}>
                  <div className="flex justify-between text-sm">
                    <Link href={`/projects/${j.projectId}/office`} className="font-semibold hover:text-haxis-400">
                      {AGENTS[j.agentType as AgentType]?.label ?? j.agentType} · {j.projectTitle}
                    </Link>
                    <span className="text-ink-400 tabular-nums">{Math.round(j.progress * 100)}%</span>
                  </div>
                  <div className="mb-1 truncate text-xs text-ink-400">{j.task}</div>
                  <Progress value={j.progress} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Falhas e bloqueios (${cc.failures.length})`}>
          {cc.failures.length === 0 ? (
            <Empty title="Nenhum bloqueio" />
          ) : (
            <ul className="divide-y divide-ink-700">
              {cc.failures.map((f) => (
                <li key={f.id} className="py-2.5">
                  <Link href={`/projects/${f.id}`} className="font-semibold hover:text-haxis-400">{f.title}</Link>
                  <div className="text-xs text-bad-500">{f.error}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Projetos ativos">
        {cc.activeProjects.length === 0 ? (
          <Empty title="Nenhum projeto ativo">
            <Link className="text-haxis-400" href="/projects/new">Criar o primeiro projeto</Link>
          </Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400 uppercase">
              <tr><th className="py-2">Projeto</th><th>Marca</th><th>Estado</th><th className="text-right">Atualizado</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {cc.activeProjects.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5"><Link href={`/projects/${p.id}`} className="font-semibold hover:text-haxis-400">{p.title}</Link></td>
                  <td className="text-ink-300">{p.brand}</td>
                  <td><StateBadge state={p.status} /></td>
                  <td className="text-right text-ink-400 tabular-nums">{new Date(p.updatedAt).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
