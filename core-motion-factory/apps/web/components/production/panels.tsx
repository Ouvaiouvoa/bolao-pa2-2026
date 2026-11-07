"use client";
import { useState } from "react";
import { AGENTS, type AgentType, type CreativeDirection, type EventEnvelope, type Selects } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { LocalTime } from "../time";
import { Badge, cents, Empty, ErrorBox, Input, ms } from "../ui";

export function DirectionPanel({ snap }: { snap: ProjectSnapshot }) {
  const brief = snap.brief?.content as Record<string, unknown> | undefined;
  const dir = snap.artifacts.creative_direction?.payload as CreativeDirection | undefined;
  const selects = snap.artifacts.selects?.payload as Selects | undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-ink-400 uppercase">Briefing v{snap.brief?.version} {snap.brief?.approvedAt ? <Badge tone="ok">aprovado</Badge> : <Badge>pendente</Badge>}</h3>
        {brief ? (
          <dl className="grid gap-1 text-sm">
            <div><dt className="inline text-ink-400">Objetivo: </dt><dd className="inline">{String(brief.goalStatement)}</dd></div>
            <div><dt className="inline text-ink-400">Público: </dt><dd className="inline">{String(brief.audience || "—")}</dd></div>
            <div><dt className="inline text-ink-400">CTA: </dt><dd className="inline">{(brief.cta as { text: string }).text}</dd></div>
            <div><dt className="inline text-ink-400">Palavras-chave: </dt><dd className="inline">{(brief.keywords as string[]).join(", ") || "—"}</dd></div>
            <div><dt className="inline text-ink-400">Duração: </dt><dd className="inline">{(brief.durationTargetSec as { min: number; max: number }).min}–{(brief.durationTargetSec as { min: number; max: number }).max}s</dd></div>
          </dl>
        ) : (
          <Empty title="Sem briefing" />
        )}
        {dir && (
          <div className="mt-4 text-sm">
            <h3 className="mb-1 text-xs font-semibold text-ink-400 uppercase">Direção criativa</h3>
            <p>{dir.rationale}</p>
            <p className="mt-1 text-ink-300">Gancho: {dir.hookStrategy}</p>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-ink-400 uppercase">Selects do Curador</h3>
        {selects ? (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto text-xs">
            {selects.candidates.map((c) => (
              <li key={c.id} className={`rounded-lg border p-2 ${c.selected ? "border-ok-500/40" : "border-ink-700 opacity-70"}`}>
                <div className="flex items-center gap-2">
                  <Badge tone={c.selected ? "ok" : "neutral"}>{c.selected ? c.role : "descartado"}</Badge>
                  <span className="tabular-nums text-ink-400">{(c.startMs / 1000).toFixed(1)}–{(c.endMs / 1000).toFixed(1)}s</span>
                  <span className="ml-auto font-semibold tabular-nums">{Math.round(c.scores.total * 100)}</span>
                </div>
                <div className="mt-1 text-ink-200">{c.text}</div>
                <div className="text-ink-400">{c.rejectedReason ?? c.reasons.join(" · ")}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Selects aparecem após a análise" />
        )}
      </div>
    </div>
  );
}

export function TranscriptPanel({ snap, refresh }: { snap: ProjectSnapshot; refresh: () => Promise<void>; onSeekSource: (ms: number) => void }) {
  const [editing, setEditing] = useState<{ assetId: string; index: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = snap.user.permissions.includes("transcript.edit");
  if (!snap.transcripts.length) return <Empty title="Transcrição ainda não disponível" />;
  async function save() {
    if (!editing) return;
    try {
      await api(`/api/projects/${snap.project.id}/transcript`, { method: "PATCH", body: { assetId: editing.assetId, edits: [{ wordIndex: editing.index, text: editing.text }] } });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      {snap.transcripts.map((t) => (
        <div key={t.id}>
          <div className="mb-2 flex flex-wrap gap-2 text-xs text-ink-400">
            <Badge>{t.provider} · {t.model}</Badge>
            <Badge>v{t.version}{t.editedBy ? " (editada)" : ""}</Badge>
            <Badge tone={(t.confidence ?? 1) >= 0.85 ? "ok" : "warn"}>confiança {t.confidence !== null ? Math.round(t.confidence * 100) + "%" : "—"}</Badge>
            <span>{t.words.length} palavras · {t.language}</span>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg bg-ink-900 p-3 text-sm leading-7" data-testid="transcript-words">
            {t.segments.map((s) => (
              <p key={s.id} className="mb-1">
                <span className="mr-2 font-mono text-[10px] text-ink-500">{(s.startMs / 1000).toFixed(1)}s</span>
                {t.words.slice(s.wordStart, s.wordEnd + 1).map((w, k) => {
                  const idx = s.wordStart + k;
                  const low = w.confidence !== null && w.confidence < 0.6;
                  if (editing && editing.assetId === t.assetId && editing.index === idx)
                    return (
                      <span key={idx} className="inline-flex items-center gap-1">
                        <Input autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} className="h-7 w-32" />
                        <button className="text-xs text-ok-500" onClick={save}>salvar</button>
                      </span>
                    );
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={!canEdit}
                      title={`${(w.startMs / 1000).toFixed(2)}s · confiança ${w.confidence ?? "—"}`}
                      onClick={() => setEditing({ assetId: t.assetId, index: idx, text: w.text })}
                      className={`mr-1 rounded px-0.5 ${low ? "bg-warn-500/25 text-warn-500 underline decoration-dotted" : "hover:bg-ink-700"}`}
                    >
                      {w.text}
                    </button>
                  );
                })}
              </p>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">Palavras em amarelo têm baixa confiança. Clique para corrigir — cada correção gera uma nova versão da transcrição.</p>
        </div>
      ))}
    </div>
  );
}

export function DeliverablesPanel({ snap }: { snap: ProjectSnapshot }) {
  const byAgent = new Map<string, { runs: number; cost: number; ms: number; cached: number }>();
  for (const r of snap.agentRuns) {
    const v = byAgent.get(r.agentType) ?? { runs: 0, cost: 0, ms: 0, cached: 0 };
    v.runs++;
    v.cost += r.costCents ?? 0;
    v.ms += r.latencyMs ?? 0;
    if (r.status === "cached") v.cached++;
    byAgent.set(r.agentType, v);
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-ink-400 uppercase">Arquivos</h3>
        {snap.downloads.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="downloads">
            {snap.downloads.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2">
                <a className="text-haxis-400 hover:underline" href={f.url ?? "#"} download={f.name}>{f.name}</a>
                <span className="font-mono text-[10px] text-ink-500" title={f.checksum}>{(f.sizeBytes / 1024).toFixed(0)} KB · sha256 {f.checksum.slice(0, 10)}…</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="O pacote de entrega é gerado após o QA do master" />
        )}
        {snap.captionFiles && (
          <div className="mt-3 flex gap-3 text-sm">
            <a className="text-haxis-400 hover:underline" href={snap.captionFiles.srt ?? "#"}>legendas.srt</a>
            <a className="text-haxis-400 hover:underline" href={snap.captionFiles.vtt ?? "#"}>legendas.vtt</a>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold text-ink-400 uppercase">Agentes envolvidos, custo e tempo</h3>
        {byAgent.size ? (
          <table className="w-full text-xs">
            <thead className="text-left text-ink-400"><tr><th>Agente</th><th>Execuções</th><th>Cache</th><th>Tempo</th>{snap.costs && <th>Custo</th>}</tr></thead>
            <tbody>
              {[...byAgent.entries()].map(([a, v]) => (
                <tr key={a} className="border-t border-ink-800"><td className="py-1">{AGENTS[a as AgentType]?.label ?? a}</td><td>{v.runs}</td><td>{v.cached}</td><td>{ms(v.ms)}</td>{snap.costs && <td>{cents(v.cost)}</td>}</tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Sem execuções ainda" />
        )}
      </div>
    </div>
  );
}

export function EventLog({ events }: { events: EventEnvelope[] }) {
  if (!events.length) return <Empty title="Aguardando eventos" />;
  return (
    <ol className="max-h-80 overflow-auto font-mono text-[11px]">
      {[...events].reverse().slice(0, 300).map((e) => (
        <li key={e.id} className="flex gap-2 border-b border-ink-800 py-1">
          <span className="text-ink-500">#{e.id}</span>
          <span className="text-ink-400"><LocalTime iso={e.createdAt} variant="time" /></span>
          <span className="text-haxis-400">{e.eventType}</span>
          <span className="truncate text-ink-300">{summarize(e)}</span>
        </li>
      ))}
    </ol>
  );
}

function summarize(e: EventEnvelope): string {
  const p = e.payload as Record<string, unknown>;
  if (e.eventType === "project.state.changed") return `${p.from} → ${p.to}: ${p.reason}`;
  if (e.eventType.startsWith("agent.run")) return `${p.agentType} ${p.task ?? p.summary ?? p.message ?? ""}`;
  if (e.eventType === "agent.artifact.created") return `${p.type} v${p.version}`;
  if (e.eventType.startsWith("approval")) return `${p.artifactType} ${p.reason ?? ""}`;
  return JSON.stringify(p).slice(0, 140);
}
