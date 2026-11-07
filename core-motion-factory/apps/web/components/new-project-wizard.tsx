"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHANNEL_LABELS, CHANNELS, OBJECTIVE_LABELS, OBJECTIVES, type Channel, type Objective } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { uploadFile, type UploadProgress } from "@/lib/client/upload";
import { Badge, Button, Card, cx, ErrorBox, Field, Input, Progress, Select, Textarea } from "./ui";

interface Props {
  brands: { id: string; name: string; defaultTemplateId: string }[];
  templates: { id: string; name: string; description: string; status: string; objectives: string[] }[];
}

const STEPS = ["Marca", "Objetivo e canal", "Briefing", "Materiais", "Template", "Limites", "Revisar e iniciar"];
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function NewProjectWizard({ brands, templates }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const [form, setForm] = useState({
    brandId: brands[0]?.id ?? "",
    title: "",
    objective: "authority" as Objective,
    channel: "instagram_reels" as Channel,
    goalStatement: "",
    audience: "",
    keyMessages: "",
    keywords: "",
    ctaText: "",
    ctaUrl: "",
    tone: "",
    speakerName: "",
    speakerRole: "",
    restrictions: "",
    headline: "",
    variantsAB: false,
    durMin: 25,
    durMax: 60,
    aiMode: "deterministic" as "deterministic" | "llm_assisted",
    templateId: "",
    maxAi: 200,
    maxRender: 300,
    maxTotal: 500,
    maxRevisions: 3,
    deadline: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const brief = () => ({
    objective: form.objective,
    goalStatement: form.goalStatement,
    channel: form.channel,
    formats: ["9:16"],
    audience: form.audience,
    keyMessages: lines(form.keyMessages),
    keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    cta: { text: form.ctaText, url: form.ctaUrl || null },
    tone: form.tone,
    durationTargetSec: { min: Number(form.durMin), max: Number(form.durMax) },
    speaker: form.speakerName ? { name: form.speakerName, role: form.speakerRole } : null,
    restrictions: lines(form.restrictions),
    variantsAB: form.variantsAB,
    headline: form.headline || null,
    language: "pt-BR",
  });
  const costPolicy = () => ({ maxAiCostCents: Number(form.maxAi), maxRenderCostCents: Number(form.maxRender), maxTotalCostCents: Number(form.maxTotal), maxRevisionRounds: Number(form.maxRevisions), maxAgentSteps: 120, deadlineAt: form.deadline ? new Date(form.deadline).toISOString() : null });

  async function next() {
    setError(null);
    setBusy(true);
    try {
      if (step === 2 && !projectId) {
        const res = await api<{ id: string }>("/api/projects", { body: { brandId: form.brandId, title: form.title, brief: brief(), costPolicy: costPolicy(), aiMode: form.aiMode }, idempotent: true });
        setProjectId(res.id);
      } else if (step === 2 && projectId) {
        await api(`/api/projects/${projectId}/briefs`, { body: { content: brief() } });
      }
      if (step === 3 && !Object.values(uploads).some((u) => u.status === "done")) throw new Error("envie ao menos um vídeo");
      if (step === 4 && projectId && form.templateId) await api(`/api/projects/${projectId}`, { method: "PATCH", body: { templateId: form.templateId } });
      if (step === 5 && projectId) await api(`/api/projects/${projectId}`, { method: "PATCH", body: { costPolicy: costPolicy() } });
      setStep((s) => s + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/start`, { body: {}, idempotent: true });
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || !projectId) return;
    for (const file of Array.from(files)) {
      try {
        await uploadFile(file, { projectId, purpose: "project_media" }, (p) => setUploads((u) => ({ ...u, [file.name]: p })));
      } catch (err) {
        setError(`${file.name}: ${errorText(err)}`);
      }
    }
  }

  if (!brands.length)
    return (
      <Card title="Novo projeto">
        <p className="text-sm text-ink-300">Cadastre uma marca com identidade antes de criar projetos.</p>
        <Link className="mt-3 inline-block text-haxis-400" href="/brands/new">Criar marca →</Link>
      </Card>
    );

  const canNext =
    (step === 0 && form.brandId && form.title.length >= 2) ||
    step === 1 ||
    (step === 2 && form.goalStatement.length >= 10 && form.ctaText.length >= 2 && form.durMax >= form.durMin) ||
    step === 3 ||
    step === 4 ||
    step === 5;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold">Novo projeto</h1>
      <ol className="flex flex-wrap gap-2" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className={cx("rounded-full px-3 py-1 text-xs font-semibold", i === step ? "bg-haxis-500 text-white" : i < step ? "bg-ok-500/20 text-ok-500" : "bg-ink-800 text-ink-400")}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <Card title={STEPS[step]}>
        <div className="flex flex-col gap-4">
          {step === 0 && (
            <>
              <Field label="Marca">
                <Select value={form.brandId} onChange={(e) => set("brandId", e.target.value)} disabled={Boolean(projectId)}>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Título do projeto">
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Reel de autoridade — 3 erros" />
              </Field>
            </>
          )}
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Objetivo">
                <Select value={form.objective} onChange={(e) => set("objective", e.target.value as Objective)}>
                  {OBJECTIVES.map((o) => <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>)}
                </Select>
              </Field>
              <Field label="Canal">
                <Select value={form.channel} onChange={(e) => set("channel", e.target.value as Channel)}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                </Select>
              </Field>
              <p className="text-xs text-ink-400 sm:col-span-2">Formato do MVP: vertical 9:16 em 1080×1920 (H.264/AAC).</p>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Objetivo da peça (o que o público deve entender/fazer)"><Textarea value={form.goalStatement} onChange={(e) => set("goalStatement", e.target.value)} /></Field></div>
              <Field label="Público-alvo"><Input value={form.audience} onChange={(e) => set("audience", e.target.value)} /></Field>
              <Field label="Tom"><Input value={form.tone} onChange={(e) => set("tone", e.target.value)} placeholder="didático, direto" /></Field>
              <Field label="Mensagens-chave (uma por linha)"><Textarea value={form.keyMessages} onChange={(e) => set("keyMessages", e.target.value)} /></Field>
              <Field label="Palavras-chave (separadas por vírgula)"><Textarea value={form.keywords} onChange={(e) => set("keywords", e.target.value)} /></Field>
              <Field label="CTA"><Input value={form.ctaText} onChange={(e) => set("ctaText", e.target.value)} placeholder="Comente ROTEIRO" /></Field>
              <Field label="Link do CTA (opcional)"><Input value={form.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Apresentador (lower third)"><Input value={form.speakerName} onChange={(e) => set("speakerName", e.target.value)} /></Field>
              <Field label="Cargo do apresentador"><Input value={form.speakerRole} onChange={(e) => set("speakerRole", e.target.value)} /></Field>
              <Field label="Título de gancho (opcional)" hint="vazio = derivado da melhor fala"><Input value={form.headline} onChange={(e) => set("headline", e.target.value)} /></Field>
              <Field label="Restrições regulatórias/comerciais (uma por linha)"><Textarea value={form.restrictions} onChange={(e) => set("restrictions", e.target.value)} /></Field>
              <Field label="Duração mínima (s)"><Input type="number" value={form.durMin} onChange={(e) => set("durMin", Number(e.target.value))} /></Field>
              <Field label="Duração máxima (s)"><Input type="number" value={form.durMax} onChange={(e) => set("durMax", Number(e.target.value))} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.variantsAB} onChange={(e) => set("variantsAB", e.target.checked)} /> Gerar variantes A/B de gancho</label>
              <Field label="Modo de IA" hint="LLM só é usado se a política da organização permitir provedores externos e houver chave configurada">
                <Select value={form.aiMode} onChange={(e) => set("aiMode", e.target.value as "deterministic" | "llm_assisted")} disabled={Boolean(projectId)}>
                  <option value="deterministic">Determinístico (heuristic-v1, sem dados para terceiros)</option>
                  <option value="llm_assisted">Assistido por LLM (Claude)</option>
                </Select>
              </Field>
            </div>
          )}
          {step === 3 && (
            <>
              <p className="text-sm text-ink-300">Envie os vídeos brutos (upload multipart retomável com URLs assinadas). Os originais ficam imutáveis.</p>
              <input type="file" accept="video/*,audio/*" multiple onChange={(e) => onFiles(e.target.files)} data-testid="media-input" className="text-sm" />
              <ul className="flex flex-col gap-2">
                {Object.values(uploads).map((u) => (
                  <li key={u.fileName} className="text-sm">
                    <div className="flex justify-between"><span>{u.fileName}</span><Badge tone={u.status === "done" ? "ok" : u.status === "error" ? "bad" : "info"}>{u.status === "done" ? "enviado" : u.status === "error" ? "erro" : u.status === "completing" ? "verificando checksum" : `${Math.round((u.sent / u.total) * 100)}%`}</Badge></div>
                    <Progress value={u.sent / Math.max(1, u.total)} tone={u.status === "error" ? "bad" : u.status === "done" ? "ok" : "accent"} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {step === 4 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => {
                const selectable = t.status !== "planned";
                const active = (form.templateId || brands.find((b) => b.id === form.brandId)?.defaultTemplateId) === t.id;
                return (
                  <button key={t.id} type="button" disabled={!selectable} onClick={() => set("templateId", t.id)} className={cx("rounded-xl border p-4 text-left transition", active ? "border-haxis-500 bg-haxis-500/10" : "border-ink-600 hover:border-ink-400", !selectable && "opacity-40")}>
                    <div className="flex items-center justify-between"><span className="font-semibold">{t.name}</span><Badge tone={t.status === "available" ? "ok" : t.status === "beta" ? "info" : "neutral"}>{t.status === "available" ? "disponível" : t.status === "beta" ? "beta" : "planejado"}</Badge></div>
                    <p className="mt-1 text-xs text-ink-400">{t.description}</p>
                  </button>
                );
              })}
            </div>
          )}
          {step === 5 && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Limite de IA (¢ US$)"><Input type="number" value={form.maxAi} onChange={(e) => set("maxAi", Number(e.target.value))} /></Field>
              <Field label="Limite de render (¢ US$)"><Input type="number" value={form.maxRender} onChange={(e) => set("maxRender", Number(e.target.value))} /></Field>
              <Field label="Limite total (¢ US$)"><Input type="number" value={form.maxTotal} onChange={(e) => set("maxTotal", Number(e.target.value))} /></Field>
              <Field label="Rodadas de revisão"><Input type="number" value={form.maxRevisions} onChange={(e) => set("maxRevisions", Number(e.target.value))} /></Field>
              <Field label="Prazo (opcional)"><Input type="datetime-local" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} /></Field>
            </div>
          )}
          {step === 6 && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-400">Projeto</dt><dd className="font-semibold">{form.title}</dd></div>
              <div><dt className="text-ink-400">Marca</dt><dd>{brands.find((b) => b.id === form.brandId)?.name}</dd></div>
              <div><dt className="text-ink-400">Objetivo / canal</dt><dd>{OBJECTIVE_LABELS[form.objective]} · {CHANNEL_LABELS[form.channel]}</dd></div>
              <div><dt className="text-ink-400">CTA</dt><dd>{form.ctaText}</dd></div>
              <div><dt className="text-ink-400">Materiais</dt><dd>{Object.values(uploads).filter((u) => u.status === "done").length} arquivo(s)</dd></div>
              <div><dt className="text-ink-400">Limite total</dt><dd>{form.maxTotal}¢ · {form.maxRevisions} revisões</dd></div>
              <p className="text-xs text-ink-400 sm:col-span-2">Ao iniciar, os agentes executam ingestão, transcrição e análise. O briefing, o roteiro, o preview e o master exigem sua aprovação explícita. Nada é publicado automaticamente.</p>
            </dl>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy || (step === 3 && Boolean(projectId) && false)}>← Voltar</Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next} disabled={!canNext || busy}>{busy ? "Salvando…" : "Continuar →"}</Button>
            ) : (
              <Button variant="primary" onClick={start} disabled={busy} data-testid="start-production">{busy ? "Iniciando…" : "Iniciar produção"}</Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
