"use client";
import Link from "next/link";
import type { PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, AGENT_TYPES, type AgentType, type EditPlan } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { useProjectSnapshot } from "@/lib/client/snapshot";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { StateBadge } from "../state-badge";
import { Elapsed } from "../time";
import { Badge, Button, Card, cents, cx, Empty, ErrorBox, Progress } from "../ui";
import { Gates } from "./gates";
import { PlanPlayer } from "./player";
import { Properties } from "./properties";
import { Timeline, type Selection } from "./timeline";
import { DeliverablesPanel, DirectionPanel, EventLog, TranscriptPanel } from "./panels";

const EDITABLE_STATES = ["IN_REVIEW", "REVISION_REQUESTED", "AWAITING_SCRIPT_APPROVAL", "APPROVED", "BLOCKED"];

export function ProductionRoom({ initial }: { initial: ProjectSnapshot }) {
  const { snap, refresh, events, connected } = useProjectSnapshot(initial);
  const playerRef = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const [draft, setDraft] = useState<EditPlan | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"direction" | "transcript" | "deliverables" | "events">("direction");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const serverPlan = snap.editPlan?.plan ?? null;
  const plan = draft ?? serverPlan;
  const canEdit = snap.user.permissions.includes("timeline.edit") && EDITABLE_STATES.includes(snap.project.status);
  const dirty = draft !== null;

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [plan?.composition.durationInFrames]);

  const latestRuns = useMemo(() => {
    const m = new Map<string, ProjectSnapshot["agentRuns"][number]>();
    for (const r of snap.agentRuns) if (!m.has(r.agentType)) m.set(r.agentType, r);
    return m;
  }, [snap.agentRuns]);

  async function save() {
    if (!draft || !snap.editPlan) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api(`/api/projects/${snap.project.id}/edit-plans`, { body: { payload: draft, note: "edição manual na timeline", basedOnVersion: snap.editPlan.version }, idempotent: true });
      setDraft(null);
      await refresh();
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-extrabold" data-testid="project-title">{snap.project.title}</h1>
            <span data-testid="project-state"><StateBadge state={snap.project.status} hold={Boolean(snap.project.hold)} /></span>
            <Badge tone={connected ? "ok" : "neutral"}>{connected ? "● ao vivo" : "○ reconectando"}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-400">
            <span>{snap.brand.name}</span>
            <span>edit plan {snap.editPlan ? `v${snap.editPlan.version}` : "—"}</span>
            {snap.costs && <span>custo {cents(snap.costs.totalCents)} (IA {cents(snap.costs.aiCents)} · render {cents(snap.costs.renderCents)})</span>}
            <span>tempo <Elapsed since={snap.project.createdAt} /></span>
            <span>revisões {snap.project.revisionRound}</span>
            {snap.project.traceId && <span className="font-mono">trace {snap.project.traceId}</span>}
          </div>
        </div>
        <nav className="flex gap-2">
          <Link className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm hover:bg-ink-800" href={`/projects/${snap.project.id}/office`}>Escritório vivo</Link>
          <Link className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm hover:bg-ink-800" href={`/projects/${snap.project.id}/review`}>Review</Link>
          {snap.user.permissions.includes("audit.view") && <Link className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm hover:bg-ink-800" href={`/projects/${snap.project.id}/audit`}>Auditoria</Link>}
        </nav>
      </header>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* Left: agents and tasks */}
        <div className="flex flex-col gap-4">
          <Card title="Agentes" dense>
            <ul className="flex flex-col">
              {AGENT_TYPES.map((a) => {
                const r = latestRuns.get(a);
                const tone = !r ? "neutral" : r.status === "succeeded" || r.status === "cached" ? "ok" : r.status === "failed" ? "bad" : r.status === "blocked" ? "warn" : "info";
                return (
                  <li key={a} className="rounded-lg px-2 py-1.5 hover:bg-ink-800" data-testid={`agent-row-${a}`}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{AGENTS[a as AgentType].label}</span>
                      <Badge tone={tone}>{r ? r.status : "aguardando"}</Badge>
                    </div>
                    {r && r.status === "running" && <Progress value={r.progress} />}
                    {r?.currentTask && <div className="truncate text-[11px] text-ink-400" title={r.currentTask}>{r.currentTask}</div>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Center: player + gates + timeline */}
        <div className="flex min-w-0 flex-col gap-4">
          <Gates snap={snap} refresh={refresh} />
          <Card title="Player" actions={plan ? <span className="text-xs text-ink-400">{plan.composition.width}×{plan.composition.height} · {plan.composition.fps} fps</span> : null}>
            {plan ? (
              <div className="flex justify-center"><div className="w-full max-w-[380px]"><PlanPlayer ref={playerRef} plan={plan} brand={snap.brand} media={snap.media} /></div></div>
            ) : snap.assets[0]?.proxyUrl ? (
              <video src={snap.assets[0].proxyUrl} controls className="mx-auto max-h-[50vh] rounded-lg" />
            ) : (
              <Empty title="A composição aparece aqui após a montagem">Os agentes estão processando os materiais.</Empty>
            )}
          </Card>
          {plan && (
            <Card
              title="Timeline"
              actions={
                <>
                  {dirty && <Badge tone="warn">alterações não salvas</Badge>}
                  {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Descartar</Button>}
                  {canEdit && <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save} data-testid="save-plan">{saving ? "Validando…" : "Salvar nova versão"}</Button>}
                </>
              }
            >
              {saveError && <div className="mb-2"><ErrorBox>{saveError}</ErrorBox></div>}
              <Timeline plan={plan} frame={frame} editable={canEdit} selection={selection} onSelect={setSelection} onChange={setDraft} onSeek={(f) => { playerRef.current?.seekTo(f); setFrame(f); }} />
              {snap.editPlan && snap.editPlan.issues.length > 0 && !dirty && (
                <ul className="mt-2 text-xs text-warn-500">{snap.editPlan.issues.slice(0, 5).map((i, k) => <li key={k}>⚠ {i.message} ({i.path})</li>)}</ul>
              )}
            </Card>
          )}
          <Card dense>
            <div className="mb-2 flex gap-1 border-b border-ink-700 px-2" role="tablist">
              {([["direction", "Briefing e direção"], ["transcript", "Transcrição"], ["deliverables", "Entregáveis e custos"], ["events", `Eventos (${events.length})`]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={cx("px-3 py-2 text-sm", tab === k ? "border-b-2 border-haxis-500 font-semibold" : "text-ink-400")} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            <div className="p-2">
              {tab === "direction" && <DirectionPanel snap={snap} />}
              {tab === "transcript" && <TranscriptPanel snap={snap} refresh={refresh} onSeekSource={() => undefined} />}
              {tab === "deliverables" && <DeliverablesPanel snap={snap} />}
              {tab === "events" && <EventLog events={events} />}
            </div>
          </Card>
        </div>

        {/* Right: properties / brand inspection */}
        <div className="flex flex-col gap-4">
          <Card title="Propriedades">{plan ? <Properties plan={plan} selection={selection} onChange={setDraft} editable={canEdit} /> : <p className="text-sm text-ink-400">Sem composição ainda.</p>}</Card>
          <Card title="Marca">
            <div className="flex flex-wrap gap-2">
              {Object.entries(snap.brand.tokens.colors).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5 text-xs"><span className="h-4 w-4 rounded border border-ink-600" style={{ background: v }} />{k}</div>
              ))}
            </div>
            <div className="mt-2 text-xs text-ink-400">{snap.brand.tokens.typography.heading} / {snap.brand.tokens.typography.body} · legendas até {snap.brand.tokens.captions.maxLines}×{snap.brand.tokens.captions.maxCharsPerLine} · rodapé “{snap.brand.tokens.footer.text}”</div>
            {snap.artifacts.brand_report && (
              <ul className="mt-3 flex flex-col gap-1 text-xs">
                {(snap.artifacts.brand_report.payload as { checks: { id: string; label: string; status: string; detail: string }[] }).checks.map((c) => (
                  <li key={c.id} className="flex gap-2"><span className={c.status === "pass" ? "text-ok-500" : c.status === "fail" ? "text-bad-500" : "text-warn-500"}>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "!"}</span><span>{c.label}: <span className="text-ink-400">{c.detail}</span></span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Versões do edit plan" dense>
            <ul className="max-h-60 overflow-auto text-xs">
              {snap.editPlanVersions.map((v) => (
                <li key={v.id} className="flex justify-between gap-2 px-2 py-1"><span>v{v.version} · {v.createdByType === "agent" ? v.createdById : "humano"}</span><span className="truncate text-ink-400" title={v.note}>{v.note}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
