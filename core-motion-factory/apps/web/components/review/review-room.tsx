"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMMENT_KINDS, frameToTimecode, timecodeToFrame, type CommentKind, type ComplianceReport, type QaReport } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { useProjectSnapshot } from "@/lib/client/snapshot";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { StateBadge } from "../state-badge";
import { LocalTime } from "../time";
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, Input, Select, Textarea } from "../ui";

const KIND_LABEL: Record<CommentKind, string> = { note: "Observação", cut: "Cortar trecho", text_fix: "Corrigir texto da legenda", remove_motion: "Remover elemento gráfico" };

export function ReviewRoom({ initial }: { initial: ProjectSnapshot }) {
  const { snap, refresh } = useProjectSnapshot(initial);
  const renders = snap.renders.filter((r) => r.status === "succeeded");
  const [renderId, setRenderId] = useState<string | null>(renders[0]?.id ?? null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const current = renders.find((r) => r.id === renderId) ?? renders[0] ?? null;
  const compare = renders.find((r) => r.id === compareId) ?? null;
  const video = useRef<HTMLVideoElement>(null);
  const video2 = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const fps = current?.fps ?? 30;
  const [kind, setKind] = useState<CommentKind>("note");
  const [body, setBody] = useState("");
  const [endMs, setEndMs] = useState<number | null>(null);
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [goto, setGoto] = useState("");

  useEffect(() => {
    if (!renderId && renders[0]) setRenderId(renders[0].id);
  }, [renders, renderId]);

  const comments = useMemo(() => snap.comments.filter((c) => c.renderId === current?.id), [snap.comments, current?.id]);
  const step = (frames: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + frames / fps));
    if (video2.current) video2.current.currentTime = v.currentTime;
  };
  const seek = (ms: number) => {
    if (video.current) video.current.currentTime = ms / 1000;
    if (video2.current) video2.current.currentTime = ms / 1000;
  };
  /** Keyboard seek: lands in the middle of the requested frame (avoids float rounding to the previous one). */
  const gotoTimecode = () => {
    try {
      const f = timecodeToFrame(goto, fps);
      seek(((f + 0.5) / fps) * 1000);
      setError(null);
    } catch {
      setError("timecode inválido (use HH:MM:SS:FF)");
    }
  };

  async function act(fn: () => Promise<unknown>) {
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
  }

  const addComment = () =>
    act(async () => {
      if (!current) return;
      await api(`/api/renders/${current.id}/comments`, { body: { timecodeMs: Math.round(t * 1000), body: body || KIND_LABEL[kind], kind, endTimecodeMs: kind === "cut" ? endMs : null, replacement: kind === "text_fix" ? replacement : null }, idempotent: true });
      setBody("");
      setReplacement("");
      setEndMs(null);
    });

  const pendingPreview = snap.approvalRequests.find((r) => r.artifactType === "render_preview");
  const pendingMaster = snap.approvalRequests.find((r) => r.artifactType === "render_master");
  const can = (p: string) => snap.user.permissions.includes(p);
  const qa = snap.artifacts.qa_report?.payload as QaReport | undefined;
  const compliance = snap.artifacts.compliance_report?.payload as ComplianceReport | undefined;
  const brandReport = snap.artifacts.brand_report?.payload as { checks: { id: string; label: string; status: string; detail: string }[] } | undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${snap.project.id}`} className="text-sm text-ink-400 hover:text-ink-100">← Sala de produção</Link>
          <h1 className="text-xl font-extrabold">Review · {snap.project.title}</h1>
          <span data-testid="project-state"><StateBadge state={snap.project.status} hold={Boolean(snap.project.hold)} /></span>
        </div>
      </header>
      {!current ? (
        <Empty title="Nenhum render disponível ainda">O preview aparece aqui assim que o Agente Render concluir.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <Card
              title={`${current.kind === "final" ? "Master" : "Preview"} · edit plan v${current.editPlanVersion} · ${current.width}×${current.height}`}
              actions={
                <Select value={compareId ?? ""} onChange={(e) => setCompareId(e.target.value || null)} className="h-8 text-xs" aria-label="Comparar com">
                  <option value="">Comparar com…</option>
                  {renders.filter((r) => r.id !== current.id).map((r) => <option key={r.id} value={r.id}>{r.kind} v{r.editPlanVersion} · {r.createdAt.slice(11, 19)} UTC</option>)}
                </Select>
              }
            >
              <div className={cx("grid gap-3", compare ? "grid-cols-2" : "grid-cols-1")}>
                <video
                  ref={video}
                  key={current.id}
                  src={current.url ?? undefined}
                  controls
                  playsInline
                  className="mx-auto max-h-[64vh] rounded-lg bg-black"
                  onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                  onSeeked={(e) => setT(e.currentTarget.currentTime)}
                  onPlay={() => video2.current?.play()}
                  onPause={() => video2.current?.pause()}
                  data-testid="review-video"
                />
                {compare && <video ref={video2} key={compare.id} src={compare.url ?? undefined} muted playsInline className="mx-auto max-h-[64vh] rounded-lg bg-black" />}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => step(-10)}>−10f</Button>
                <Button size="sm" onClick={() => step(-1)} aria-label="Frame anterior">◀ frame</Button>
                <span className="font-mono text-sm tabular-nums" data-testid="review-timecode">{frameToTimecode(Math.floor(t * fps), fps)}</span>
                <Button size="sm" onClick={() => step(1)} aria-label="Próximo frame">frame ▶</Button>
                <Button size="sm" onClick={() => step(10)}>+10f</Button>
                <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); gotoTimecode(); }}>
                  <Input aria-label="Ir para timecode" placeholder="00:00:00:00" value={goto} onChange={(e) => setGoto(e.target.value)} className="h-8 w-28 font-mono text-xs" data-testid="goto-timecode" />
                  <Button size="sm" type="submit">Ir</Button>
                </form>
                <span className="ml-auto text-xs text-ink-400">sha256 {current.checksum?.slice(0, 12)}… · {(current.durationMs! / 1000).toFixed(2)}s</span>
              </div>
              <div className="relative mt-3 h-6 rounded bg-ink-900" aria-label="Marcadores de comentários">
                {comments.map((c) => (
                  <button key={c.id} title={c.body} onClick={() => seek(c.timecodeMs)} className={cx("absolute top-1 h-4 w-1.5 rounded", c.status === "open" ? "bg-warn-500" : "bg-ok-500")} style={{ left: `${(c.timecodeMs / (current.durationMs || 1)) * 100}%` }} />
                ))}
              </div>
            </Card>
            <Card title="Versões">
              <ul className="flex flex-wrap gap-2">
                {renders.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setRenderId(r.id)} className={cx("flex items-center gap-2 rounded-lg border p-1.5 text-left text-xs", r.id === current.id ? "border-haxis-500" : "border-ink-600")}>
                      {r.thumbUrl && <img src={r.thumbUrl} alt="" className="h-14 rounded" />}
                      <span>{r.kind === "final" ? "Master" : "Preview"} v{r.editPlanVersion}<br /><span className="text-ink-400"><LocalTime iso={r.createdAt} /></span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            {(pendingPreview || pendingMaster) && (
              <Card title={pendingMaster ? "Aprovar master" : "Decisão sobre o preview"} className="border-warn-500/60">
                <Textarea placeholder="Motivo / observação" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />
                {error && <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingPreview && (
                    <>
                      <Button variant="success" disabled={busy || !can("preview.approve") || pendingPreview.artifactId !== current.id} onClick={() => act(() => api("/api/approvals", { body: { projectId: snap.project.id, artifactType: "render_preview", artifactId: pendingPreview.artifactId, decision: "granted", reason: reason || "preview aprovado" }, idempotent: true }))} data-testid="approve-preview">Aprovar preview</Button>
                      <Button variant="danger" disabled={busy || !can("comment.create") || reason.trim().length < 3} onClick={() => act(() => api(`/api/projects/${snap.project.id}/revision`, { body: { reason } }))} data-testid="request-changes">Solicitar ajustes</Button>
                    </>
                  )}
                  {pendingMaster && (
                    <>
                      <Button variant="success" disabled={busy || !can("master.approve") || pendingMaster.artifactId !== current.id} onClick={() => act(() => api("/api/approvals", { body: { projectId: snap.project.id, artifactType: "render_master", artifactId: pendingMaster.artifactId, decision: "granted", reason: reason || "master aprovado" }, idempotent: true }))} data-testid="approve-master">Aprovar master</Button>
                      <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => act(() => api("/api/approvals", { body: { projectId: snap.project.id, artifactType: "render_master", artifactId: pendingMaster.artifactId, decision: "rejected", reason }, idempotent: true }))}>Reprovar master</Button>
                    </>
                  )}
                </div>
                {((pendingPreview && pendingPreview.artifactId !== current.id) || (pendingMaster && pendingMaster.artifactId !== current.id)) && <p className="mt-2 text-xs text-warn-500">Selecione a versão mais recente para decidir.</p>}
              </Card>
            )}
            <Card title={`Comentários (${comments.length})`}>
              {can("comment.create") && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-ink-400">no timecode <span className="font-mono text-ink-200">{frameToTimecode(Math.floor(t * fps), fps)}</span></div>
                  <Select value={kind} onChange={(e) => setKind(e.target.value as CommentKind)} aria-label="Tipo de comentário" data-testid="comment-kind">
                    {COMMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </Select>
                  {kind === "cut" && (
                    <div className="flex items-center gap-2 text-xs">
                      <Button size="sm" onClick={() => setEndMs(Math.round(t * 1000))} data-testid="mark-cut-end">Marcar fim do corte</Button>
                      <span>{endMs !== null ? `até ${(endMs / 1000).toFixed(2)}s` : "posicione o player no fim do trecho"}</span>
                    </div>
                  )}
                  {kind === "text_fix" && (
                    <Field label="Texto correto da palavra neste ponto"><Input value={replacement} onChange={(e) => setReplacement(e.target.value)} data-testid="comment-replacement" /></Field>
                  )}
                  <Textarea placeholder="Comentário" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-16" data-testid="comment-body" />
                  <Button variant="primary" size="sm" disabled={busy || (kind === "cut" && (endMs === null || endMs <= t * 1000)) || (kind === "text_fix" && !replacement.trim())} onClick={addComment} data-testid="add-comment">Comentar neste timecode</Button>
                  <p className="text-xs text-ink-400">Cortes, correções de texto e remoções são aplicados automaticamente pelo Agente Editor ao solicitar ajustes.</p>
                </div>
              )}
              <ul className="mt-3 flex flex-col gap-2" data-testid="comment-list">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg border border-ink-700 p-2 text-sm">
                    <button className="font-mono text-xs text-haxis-400" onClick={() => seek(c.timecodeMs)}>{frameToTimecode(Math.floor((c.timecodeMs / 1000) * fps), fps)}{c.endTimecodeMs ? ` → ${frameToTimecode(Math.floor((c.endTimecodeMs / 1000) * fps), fps)}` : ""}</button>
                    <Badge className="ml-2">{KIND_LABEL[c.kind as CommentKind] ?? c.kind}</Badge>
                    <Badge className="ml-1" tone={c.status === "open" ? "warn" : "ok"}>{c.status === "open" ? "aberto" : c.appliedInEditPlanId ? "aplicado" : "resolvido"}</Badge>
                    <div className="mt-1">{c.body}{c.replacement ? ` → “${c.replacement}”` : ""}</div>
                    <div className="text-xs text-ink-400">{c.author} · <LocalTime iso={c.createdAt} /></div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Checklist de marca e compliance">
              <ul className="flex flex-col gap-1 text-xs">
                {brandReport?.checks.map((c) => <li key={c.id}><span className={c.status === "pass" ? "text-ok-500" : c.status === "fail" ? "text-bad-500" : "text-warn-500"}>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "!"}</span> {c.label}</li>)}
                {compliance && <li><span className={compliance.highestSeverity === "high" ? "text-warn-500" : "text-ok-500"}>{compliance.highestSeverity === "high" ? "!" : "✓"}</span> Compliance: {compliance.findings.length} alerta(s), máx. {compliance.highestSeverity}</li>}
                {qa && <li className="mt-1 font-semibold">QA: {qa.score}/100 ({qa.band})</li>}
              </ul>
            </Card>
            {snap.downloads.length > 0 && (
              <Card title="Downloads">
                <ul className="flex flex-col gap-1 text-sm" data-testid="review-downloads">
                  {snap.downloads.map((f) => <li key={f.name}><a className="text-haxis-400 hover:underline" href={f.url ?? "#"} download={f.name}>{f.name}</a></li>)}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
