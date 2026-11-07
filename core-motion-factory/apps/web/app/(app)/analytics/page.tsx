import { AGENTS, type AgentType } from "@cmf/schemas";
import { Card, cents, Empty, ms, Stat } from "@/components/ui";
import { requireUserPage } from "@/lib/server/auth";
import { analytics } from "@/lib/server/metrics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = await requireUserPage("analytics.view");
  const a = await analytics(user.organizationId);
  if (a.empty) return <Empty title="Sem dados ainda">Crie e entregue projetos para ver métricas reais.</Empty>;
  const maxStage = Math.max(1, ...a.timePerStage.map((s) => s.avgMs));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold">Analytics</h1>
        <p className="text-sm text-ink-400">Métricas medidas a partir de transições, execuções de agentes, renders e aprovações registradas.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Aprovação na 1ª versão" value={a.firstVersionApprovalRate === null ? "—" : `${Math.round(a.firstVersionApprovalRate * 100)}%`} />
        <Stat label="Retrabalho médio" value={`${a.reworkAvgRounds.toFixed(1)} rodada(s)`} />
        <Stat label="Custo por minuto final" value={cents(a.costPerFinalMinuteCents)} />
        <Stat label="Intervenções humanas" value={a.humanInterventions} hint={`${a.cachedRuns} execuções reaproveitadas de checkpoint`} />
      </div>
      <Card title="Tempo médio por etapa">
        <ul className="flex flex-col gap-2">
          {a.timePerStage.sort((x, y) => y.avgMs - x.avgMs).map((s) => (
            <li key={s.stage} className="grid grid-cols-[220px_1fr_110px] items-center gap-3 text-sm">
              <span className="truncate">{s.label}</span>
              <span className="h-2 rounded bg-ink-700"><span className="block h-2 rounded bg-haxis-500" style={{ width: `${(s.avgMs / maxStage) * 100}%` }} /></span>
              <span className="text-right text-ink-300 tabular-nums">{ms(s.avgMs)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-400">Estados de espera humana (aprovações) incluem o tempo de decisão.</p>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Agentes: falhas, latência e custo">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400"><tr><th>Agente</th><th>Execuções</th><th>Falhas</th><th>Latência média</th><th>Custo</th></tr></thead>
            <tbody>
              {Object.entries(a.failuresByAgent).map(([k, v]) => (
                <tr key={k} className="border-t border-ink-800"><td className="py-1">{AGENTS[k as AgentType]?.label ?? k}</td><td>{v.total}</td><td className={v.failed ? "text-bad-500" : ""}>{v.failed}</td><td>{ms(v.avgLatencyMs)}</td><td>{cents(v.costCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Uso de templates e volume por marca">
          <ul className="text-sm">{a.templateUsage.map((t) => <li key={t.id} className="flex justify-between border-t border-ink-800 py-1"><span>{t.name} <span className="text-xs text-ink-400">({t.status})</span></span><span>{t.projects}</span></li>)}</ul>
          <ul className="mt-4 text-sm">{a.volumeByBrand.map((b) => <li key={b.brand} className="flex justify-between border-t border-ink-800 py-1"><span>{b.brand}</span><span>{b.delivered}/{b.projects} entregues</span></li>)}</ul>
        </Card>
      </div>
      <Card title="Economia estimada versus processo manual">
        {a.baselineManualMinutesPerVideo === null ? (
          <p className="text-sm text-ink-300">Nenhuma linha de base medida. Registre o tempo médio do processo manual atual em Configurações — sem isso, nenhuma economia é declarada.</p>
        ) : (
          <p className="text-sm text-ink-300">Linha de base: {a.baselineManualMinutesPerVideo} min/vídeo (informada pela organização). Compare com o tempo medido por etapa acima.</p>
        )}
      </Card>
    </div>
  );
}
