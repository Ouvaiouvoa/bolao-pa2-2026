"use client";
import Link from "next/link";
import { useState } from "react";
import type { ComplianceReport, CreativeDirection, QaReport, Script } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { Badge, Button, Card, ErrorBox, Field, Input, Textarea } from "../ui";

function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Decision({ snap, type, refresh, approveLabel, rejectLabel, extra, permission }: { snap: ProjectSnapshot; type: string; refresh: () => Promise<void>; approveLabel: string; rejectLabel: string; extra?: Record<string, unknown>; permission: string }) {
  const { busy, error, run } = useAction(refresh);
  const [reason, setReason] = useState("");
  const req = snap.approvalRequests.find((r) => r.artifactType === type);
  const allowed = snap.user.permissions.includes(permission);
  if (!req) return null;
  const decide = (decision: "granted" | "rejected") =>
    run(() => api("/api/approvals", { body: { projectId: snap.project.id, artifactType: type, artifactId: req.artifactId, decision, reason: reason || (decision === "granted" ? "aprovado" : ""), ...extra }, idempotent: true }));
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-ink-700 pt-3">
      <p className="text-xs text-ink-400">{req.reason}</p>
      {!allowed && <p className="text-xs text-warn-500">Seu perfil não pode decidir esta aprovação ({permission}).</p>}
      <Textarea placeholder="Motivo / observação (obrigatório para reprovar)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button variant="success" disabled={busy || !allowed} onClick={() => decide("granted")} data-testid={`approve-${type}`}>{approveLabel}</Button>
        <Button variant="danger" disabled={busy || !allowed || reason.trim().length < 3} onClick={() => decide("rejected")} data-testid={`reject-${type}`}>{rejectLabel}</Button>
      </div>
    </div>
  );
}

/** Human gates of the state machine, each tied to a persisted approval request. */
export function Gates({ snap, refresh }: { snap: ProjectSnapshot; refresh: () => Promise<void> }) {
  const status = snap.project.status;
  const dir = snap.artifacts.creative_direction?.payload as CreativeDirection | undefined;
  const script = snap.artifacts.script?.payload as Script | undefined;
  const compliance = snap.artifacts.compliance_report?.payload as ComplianceReport | undefined;
  const qa = snap.artifacts.qa_report?.payload as QaReport | undefined;
  const [variant, setVariant] = useState<"A" | "B">("A");
  const act = useAction(refresh);
  const can = (p: string) => snap.user.permissions.includes(p);
  const hold = snap.project.hold;

  return (
    <div className="flex flex-col gap-4">
      {status === "AWAITING_BRIEF_APPROVAL" && dir && (
        <Card title="Aprovar briefing e direção criativa" className="border-warn-500/50">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-400">Template</dt><dd>{dir.templateId} · {dir.aspect}</dd></div>
            <div><dt className="text-ink-400">Duração ideal</dt><dd>{dir.targetDurationSec.ideal}s ({dir.targetDurationSec.min}–{dir.targetDurationSec.max}s)</dd></div>
            <div className="sm:col-span-2"><dt className="text-ink-400">Estratégia de gancho</dt><dd>{dir.hookStrategy}</dd></div>
            <div className="sm:col-span-2"><dt className="text-ink-400">Justificativa</dt><dd>{dir.rationale}</dd></div>
            <div><dt className="text-ink-400">Material</dt><dd>{dir.materialSummary.assets} asset(s), {Math.round(dir.materialSummary.speechMs / 1000)}s de fala, {dir.materialSummary.words} palavras</dd></div>
          </dl>
          {dir.risks.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-warn-500">{dir.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
          <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-300">Critérios de aceitação ({dir.acceptanceCriteria.length})</summary><ul className="mt-1 list-disc pl-5 text-ink-300">{dir.acceptanceCriteria.map((c) => <li key={c.id}>{c.description}</li>)}</ul></details>
          <Decision snap={snap} type="brief" refresh={refresh} approveLabel="Aprovar briefing" rejectLabel="Reanalisar" permission="brief.approve" />
        </Card>
      )}
      {status === "AWAITING_SCRIPT_APPROVAL" && script && (
        <Card title="Aprovar roteiro" className="border-warn-500/50">
          <div className={script.variants.length > 1 ? "grid gap-3 md:grid-cols-2" : ""}>
            {script.variants.map((v) => (
              <label key={v.id} className={`block cursor-pointer rounded-lg border p-3 ${variant === v.id ? "border-haxis-500" : "border-ink-600"}`}>
                <div className="flex items-center gap-2">
                  {script.variants.length > 1 && <input type="radio" checked={variant === v.id} onChange={() => setVariant(v.id)} />}
                  <span className="font-semibold">Variante {v.id}: “{v.hookTitle}”</span>
                  <Badge>{v.estimatedDurationSec}s</Badge>
                </div>
                <ol className="mt-2 flex flex-col gap-1 text-sm">
                  {v.beats.map((b) => (
                    <li key={b.id} className="flex gap-2"><Badge tone={b.kind === "hook" ? "accent" : b.kind === "cta" ? "ok" : "neutral"}>{b.kind}</Badge><span className="text-ink-200">{b.text}</span>{b.onScreenText && <span className="text-xs text-haxis-400">[{b.onScreenText}]</span>}</li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-ink-400">{v.rationale}</p>
              </label>
            ))}
          </div>
          <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-300">Legenda de publicação</summary><pre className="mt-1 whitespace-pre-wrap text-ink-300">{script.publishCaption}</pre></details>
          <Decision snap={snap} type="script" refresh={refresh} approveLabel={`Aprovar variante ${variant}`} rejectLabel="Pedir outro roteiro" extra={{ variant }} permission="script.approve" />
        </Card>
      )}
      {hold?.kind === "compliance" && compliance && (
        <Card title="Decisão de compliance necessária" className="border-bad-500/60">
          <p className="text-sm text-ink-300">Alertas de severidade alta bloqueiam o avanço até decisão humana. Liberar mantém o conteúdo (registrado em auditoria); reprovar volta ao roteiro sem os trechos sinalizados.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {compliance.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-ink-700 p-2 text-sm">
                <div className="flex items-center gap-2"><Badge tone={f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "neutral"}>{f.severity}</Badge><span className="font-semibold">{f.category}</span><span className="text-xs text-ink-400">{f.rule} · {f.source}{f.atMs !== null ? ` @ ${(f.atMs / 1000).toFixed(1)}s` : ""}</span></div>
                <div className="mt-1 text-ink-200">“{f.text}”</div>
                <div className="text-xs text-ink-400">Sugestão: {f.suggestion}</div>
              </li>
            ))}
          </ul>
          <Decision snap={snap} type="compliance_report" refresh={refresh} approveLabel="Liberar com justificativa" rejectLabel="Reprovar e refazer roteiro" permission="compliance.clear" />
        </Card>
      )}
      {hold?.kind === "budget" && (
        <BudgetGate snap={snap} refresh={refresh} />
      )}
      {status === "IN_REVIEW" && (
        <Card title="Preview pronto para revisão" className="border-warn-500/50">
          <p className="text-sm text-ink-300">Revise o preview, comente por timecode e aprove ou solicite ajustes.</p>
          <Link href={`/projects/${snap.project.id}/review`} className="mt-3 inline-block rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white" data-testid="go-review">Abrir revisão →</Link>
        </Card>
      )}
      {status === "REVISION_REQUESTED" && (
        <Card title="Ajustes solicitados">
          <p className="text-sm text-ink-300">Edite a timeline (sem JSON) e gere um novo preview. Comentários estruturados (corte, correção de texto, remover elemento) já foram aplicados automaticamente pelo Agente Editor quando existentes.</p>
          {act.error && <ErrorBox>{act.error}</ErrorBox>}
          <Button className="mt-3" variant="primary" disabled={act.busy || !can("render.preview")} onClick={() => act.run(() => api(`/api/projects/${snap.project.id}/renders/preview`, { body: {}, idempotent: true }))}>Gerar novo preview</Button>
        </Card>
      )}
      {status === "APPROVED" && (
        <Card title="Preview aprovado" className="border-ok-500/50">
          <p className="text-sm text-ink-300">Libere a renderização final (1080×1920, loudness normalizado) e o QA automático.</p>
          {act.error && <ErrorBox>{act.error}</ErrorBox>}
          <Button className="mt-3" variant="primary" disabled={act.busy || !can("render.final")} onClick={() => act.run(() => api(`/api/projects/${snap.project.id}/renders/final`, { body: {}, idempotent: true }))} data-testid="render-final">Liberar renderização final</Button>
        </Card>
      )}
      {(status === "READY_TO_DELIVER" || status === "BLOCKED" || status === "DELIVERED") && qa && (
        <Card title={`QA: nota ${qa.score}/100`} className={status === "BLOCKED" ? "border-bad-500/60" : "border-ok-500/50"}>
          <div className="flex flex-wrap gap-2 text-sm">
            {(["technical", "editorial", "brand", "compliance"] as const).map((d) => <Badge key={d} tone={qa.dimensions[d].score >= 90 ? "ok" : qa.dimensions[d].score >= 60 ? "warn" : "bad"}>{d}: {qa.dimensions[d].score}</Badge>)}
            <Badge tone={qa.band === "blocked" ? "bad" : qa.band === "ready" ? "ok" : "warn"}>{qa.band}</Badge>
          </div>
          {qa.blockers.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-bad-500">{qa.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
          {qa.alerts.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-warn-500">{qa.alerts.map((b) => <li key={b}>{b}</li>)}</ul>}
          <p className="mt-2 text-xs text-ink-400">{qa.note}</p>
          {status === "READY_TO_DELIVER" && <Link href={`/projects/${snap.project.id}/review`} className="mt-3 inline-block rounded-lg bg-haxis-500 px-4 py-2 text-sm font-semibold text-white">Revisar e aprovar master →</Link>}
          {status === "BLOCKED" && (
            <div className="mt-3 flex gap-2">
              {act.error && <ErrorBox>{act.error}</ErrorBox>}
              <Button disabled={act.busy} onClick={() => act.run(() => api(`/api/projects/${snap.project.id}/revision`, { body: { reason: "QA bloqueou — ajustes necessários" } }))}>Solicitar ajustes</Button>
              <Button disabled={act.busy || !can("render.final")} onClick={() => act.run(() => api(`/api/projects/${snap.project.id}/qa-recheck`, { body: {} }))}>Reexecutar QA</Button>
            </div>
          )}
        </Card>
      )}
      {snap.project.lastError && (
        <Card title="Falha na etapa" className="border-bad-500/60">
          <p className="text-sm text-bad-500">[{snap.project.lastError.code}] {snap.project.lastError.message}</p>
          {snap.project.lastError.runId && can("agent.retry") && (
            <>
              {act.error && <ErrorBox>{act.error}</ErrorBox>}
              <Button className="mt-2" disabled={act.busy} onClick={() => act.run(() => api(`/api/agent-runs/${snap.project.lastError!.runId}/retry`, { body: { reason: "retry manual pela sala de produção" }, idempotent: true }))}>Reprocessar a partir do último checkpoint</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function BudgetGate({ snap, refresh }: { snap: ProjectSnapshot; refresh: () => Promise<void> }) {
  const p = snap.project.costPolicy;
  const [total, setTotal] = useState(String((p?.maxTotalCostCents ?? 0) * 2));
  if (!p) return null;
  return (
    <Card title="Orçamento excedido" className="border-bad-500/60">
      <p className="text-sm text-ink-300">{snap.project.hold?.message}</p>
      <Field label="Novo limite total (¢ US$)"><Input type="number" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
      <Decision snap={snap} type="budget" refresh={refresh} approveLabel="Ampliar limite e continuar" rejectLabel="Manter bloqueado" permission="budget.override" extra={{ costPolicy: { ...p, maxTotalCostCents: Number(total), maxAiCostCents: Math.max(p.maxAiCostCents, Number(total) / 2), maxRenderCostCents: Math.max(p.maxRenderCostCents, Number(total) / 2) } }} />
    </Card>
  );
}
