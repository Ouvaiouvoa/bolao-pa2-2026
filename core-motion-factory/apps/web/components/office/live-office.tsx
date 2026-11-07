"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AGENT_TYPES, AGENTS, agentDependencies, deriveOfficeState, OFFICE_STATE_LABELS, type AgentType, type OfficeAgentState, type OfficeState } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { useProjectSnapshot } from "@/lib/client/snapshot";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { StateBadge } from "../state-badge";
import { LocalTime } from "../time";
import { Badge, Button, Card, cents, ErrorBox, ms, Progress } from "../ui";

const COLORS: Record<AgentType, string> = {
  director: "#FF5A1F",
  ingest: "#4EA1FF",
  transcript: "#7C5CFF",
  curator: "#19C37D",
  writer: "#F5A524",
  editor: "#00B8D9",
  motion: "#FF6FB5",
  captions: "#9BE15D",
  audio: "#FFB86B",
  brand: "#E8ECF1",
  compliance: "#E53935",
  qa: "#36CFC9",
  render: "#A78BFA",
  distribution: "#94A3B8",
};

const STATE_TONE: Record<OfficeState, "neutral" | "ok" | "warn" | "bad" | "info" | "accent"> = {
  idle: "neutral",
  reading_brief: "info",
  processing: "accent",
  waiting_dependency: "neutral",
  blocked: "warn",
  reviewing: "info",
  done: "ok",
  failed: "bad",
};

function Avatar({ agent, s }: { agent: AgentType; s: OfficeAgentState }) {
  const c = COLORS[agent];
  const active = s.state === "processing" || s.state === "reviewing" || s.state === "reading_brief";
  return (
    <svg viewBox="0 0 120 96" className="h-24 w-full" aria-hidden>
      {/* desk + monitor */}
      <rect x="8" y="70" width="104" height="8" rx="3" fill="#1c232c" />
      <rect x="58" y="34" width="44" height="30" rx="4" fill="#0b0e12" stroke={active ? c : "#2a333f"} strokeWidth="2" />
      {active && <rect x="62" y="38" width={36 * Math.max(0.08, s.progress)} height="4" rx="2" fill={c} />}
      {active && [0, 1, 2].map((k) => <rect key={k} x="62" y={46 + k * 5} width={18 + ((k * 7) % 14)} height="2" rx="1" fill="#3c4756" />)}
      <rect x="76" y="64" width="8" height="6" fill="#2a333f" />
      {/* person */}
      <g className={s.state === "idle" || s.state === "waiting_dependency" || s.state === "done" ? "anim-bob" : undefined} opacity={s.state === "waiting_dependency" ? 0.55 : 1}>
        <circle cx="34" cy="30" r="11" fill={c} />
        <rect x="20" y="43" width="28" height="27" rx="11" fill={c} opacity="0.85" />
        <g className={s.state === "processing" ? "anim-type" : s.state === "reading_brief" ? "anim-read" : undefined}>
          <rect x="44" y="56" width="16" height="5" rx="2.5" fill={c} />
        </g>
      </g>
      {/* state glyphs */}
      {s.state === "processing" && <g className="anim-spin"><circle cx="104" cy="16" r="7" fill="none" stroke={c} strokeWidth="3" strokeDasharray="10 6" /></g>}
      {s.state === "reading_brief" && <g className="anim-read"><rect x="96" y="8" width="14" height="17" rx="2" fill="#e8ecf1" /><rect x="99" y="12" width="8" height="1.6" fill="#6b7787" /><rect x="99" y="16" width="8" height="1.6" fill="#6b7787" /></g>}
      {s.state === "reviewing" && <g className="anim-read"><circle cx="102" cy="14" r="6" fill="none" stroke={c} strokeWidth="2.5" /><line x1="106" y1="18" x2="111" y2="23" stroke={c} strokeWidth="2.5" /></g>}
      {s.state === "waiting_dependency" && <text x="98" y="22" fontSize="16" fill="#9aa5b4">⌛</text>}
      {s.state === "done" && <g><circle cx="104" cy="16" r="9" fill="#19C37D" /><path d="M99 16l3.5 3.5L109 12" stroke="#07090c" strokeWidth="2.6" fill="none" /></g>}
      {s.state === "blocked" && <g><circle className="anim-pulse" cx="104" cy="16" r="9" fill="none" stroke="#F5A524" strokeWidth="2" /><circle cx="104" cy="16" r="8" fill="#F5A524" /><text x="101" y="21" fontSize="13" fontWeight="900" fill="#07090c">!</text></g>}
      {s.state === "failed" && <g><circle className="anim-pulse" cx="104" cy="16" r="9" fill="none" stroke="#E53935" strokeWidth="2" /><circle cx="104" cy="16" r="8" fill="#E53935" /><path d="M100 12l8 8M108 12l-8 8" stroke="#fff" strokeWidth="2.4" /></g>}
    </svg>
  );
}

/**
 * Live Office: every visual state is derived from persisted events (deriveOfficeState) and shows
 * the id of the event that justifies it. No animation without a backing event.
 */
export function LiveOffice({ initial }: { initial: ProjectSnapshot }) {
  const { snap, refresh, events, connected } = useProjectSnapshot(initial);
  const office = useMemo(() => deriveOfficeState(events), [events]);
  const [open, setOpen] = useState<AgentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runsByAgent = useMemo(() => {
    const m = new Map<string, ProjectSnapshot["agentRuns"]>();
    for (const r of snap.agentRuns) m.set(r.agentType, [...(m.get(r.agentType) ?? []), r]);
    return m;
  }, [snap.agentRuns]);
  const sel = open ? office[open] : null;
  const latestRun = open ? (runsByAgent.get(open)?.[0] ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${snap.project.id}`} className="text-sm text-ink-400 hover:text-ink-100">← Sala de produção</Link>
          <h1 className="text-xl font-extrabold">Escritório vivo</h1>
          <StateBadge state={snap.project.status} hold={Boolean(snap.project.hold)} />
          <Badge tone={connected ? "ok" : "neutral"}>{connected ? "● eventos ao vivo" : "○ reconectando"}</Badge>
        </div>
        <span className="text-xs text-ink-400">{events.length} eventos persistidos · cada estado indica o evento que o comprova</span>
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-ink-700 bg-[linear-gradient(180deg,#0f1318,#0b0e12)] p-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" data-testid="office-floor">
          {AGENT_TYPES.map((a) => {
            const s = office[a];
            return (
              <button
                key={a}
                onClick={() => setOpen(a)}
                className={`rounded-xl border p-2 text-left transition hover:border-ink-400 ${open === a ? "border-haxis-500" : "border-ink-700"} bg-ink-850/60`}
                data-testid={`office-agent-${a}`}
                data-state={s.state}
                data-evidence={s.evidenceEventId ?? ""}
              >
                <Avatar agent={a} s={s} />
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold">{AGENTS[a].label}</span>
                  <Badge tone={STATE_TONE[s.state]}>{OFFICE_STATE_LABELS[s.state]}</Badge>
                </div>
                {(s.state === "processing" || s.state === "reviewing" || s.state === "reading_brief") && <div className="mt-1"><Progress value={s.progress} /></div>}
                <div className="mt-1 truncate text-[11px] text-ink-400" title={s.task ?? ""}>{s.message ?? s.task ?? "—"}</div>
                <div className="font-mono text-[10px] text-ink-500">{s.evidenceEventId ? `evento #${s.evidenceEventId}` : "sem eventos"}</div>
              </button>
            );
          })}
        </div>
        <Card title={sel ? `${AGENTS[sel.agent].label} — ${AGENTS[sel.agent].role}` : "Detalhes do agente"}>
          {!sel ? (
            <p className="text-sm text-ink-400">Clique num agente para ver tarefa, entradas, progresso, artefatos, custo, logs e dependências.</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm" data-testid="office-drawer">
              <div className="flex flex-wrap gap-2">
                <Badge tone={STATE_TONE[sel.state]}>{OFFICE_STATE_LABELS[sel.state]}</Badge>
                <Badge>evidência: evento #{sel.evidenceEventId ?? "—"}</Badge>
                <Badge>{sel.runs} execução(ões)</Badge>
              </div>
              <div><span className="text-ink-400">Tarefa atual: </span>{latestRun?.currentTask ?? sel.task ?? "—"}</div>
              {latestRun && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-ink-400">Status: </span>{latestRun.status}</div>
                    <div><span className="text-ink-400">Modelo: </span>{latestRun.model ?? "—"}</div>
                    <div><span className="text-ink-400">Latência: </span>{ms(latestRun.latencyMs)}</div>
                    <div><span className="text-ink-400">Custo: </span>{cents(latestRun.costCents)}</div>
                    <div><span className="text-ink-400">Tokens: </span>{latestRun.tokensIn}/{latestRun.tokensOut}</div>
                    <div><span className="text-ink-400">Tentativa: </span>{latestRun.attempt}</div>
                  </div>
                  <details open>
                    <summary className="cursor-pointer text-xs font-semibold text-ink-300 uppercase">Entradas utilizadas</summary>
                    <ul className="mt-1 font-mono text-[11px] text-ink-300">{(latestRun.inputRefs as { kind: string; id: string; version?: number }[]).map((r, i) => <li key={i}>{r.kind}: {r.id}{r.version ? ` v${r.version}` : ""}</li>)}</ul>
                  </details>
                  <details open>
                    <summary className="cursor-pointer text-xs font-semibold text-ink-300 uppercase">Artefatos produzidos</summary>
                    <ul className="mt-1 font-mono text-[11px] text-ink-300">
                      {(latestRun.outputRefs as { type: string; id: string; version?: number }[]).map((r, i) => <li key={i}>{r.type}: {r.id}{r.version ? ` v${r.version}` : ""}</li>)}
                      {sel.artifacts.map((a) => <li key={a.id} className="text-ink-500">evento #{a.eventId}: {a.type} v{a.version}</li>)}
                    </ul>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-ink-300 uppercase">Ferramentas chamadas ({(latestRun.toolCalls as unknown[]).length})</summary>
                    <ul className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-ink-300">{(latestRun.toolCalls as { tool: string; ok: boolean; restricted: boolean; ms: number }[]).map((t, i) => <li key={i} className={t.ok ? "" : "text-bad-500"}>{t.restricted ? "🔒 " : ""}{t.tool} · {t.ms}ms{t.ok ? "" : " · negado/erro"}</li>)}</ul>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-ink-300 uppercase">Logs</summary>
                    <ul className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-ink-300">{(latestRun.logs as { at: string; msg: string }[]).map((l, i) => <li key={i}><LocalTime iso={l.at} variant="time" /> {l.msg}</li>)}</ul>
                  </details>
                  {latestRun.error ? <ErrorBox>{JSON.stringify(latestRun.error)}</ErrorBox> : null}
                  {(latestRun.status === "failed" || latestRun.status === "blocked") && snap.user.permissions.includes("agent.retry") && (
                    <Button
                      onClick={async () => {
                        setError(null);
                        try {
                          await api(`/api/agent-runs/${latestRun.id}/retry`, { body: { reason: "retry pelo escritório vivo" }, idempotent: true });
                          await refresh();
                        } catch (err) {
                          setError(errorText(err));
                        }
                      }}
                    >
                      Reprocessar (último checkpoint)
                    </Button>
                  )}
                  {error && <ErrorBox>{error}</ErrorBox>}
                </>
              )}
              <div className="text-xs"><span className="text-ink-400">Depende de: </span>{agentDependencies(sel.agent).map((d) => AGENTS[d].label).join(", ") || "—"}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
