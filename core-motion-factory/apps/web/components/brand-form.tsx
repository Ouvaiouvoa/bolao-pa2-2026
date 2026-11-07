"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BRAND_COLOR_ROLES, DEFAULT_BRAND_TOKENS, DEFAULT_COMPLIANCE_RULES, DEFAULT_TONE_RULES, type BrandTokens, type ComplianceRules, type ToneRules } from "@cmf/schemas";
import { api, errorText } from "@/lib/client/api";
import { uploadFile } from "@/lib/client/upload";
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Textarea } from "./ui";

interface BrandData {
  id?: string;
  name: string;
  tokens: BrandTokens;
  tone: ToneRules;
  compliance: ComplianceRules;
  defaultTemplateId: string;
  assets?: { id: string; type: string; url: string; metadata: Record<string, unknown> }[];
}

export function BrandForm({ initial, templates, canManage }: { initial?: BrandData; templates: { id: string; name: string; status: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [b, setB] = useState<BrandData>(initial ?? { name: "", tokens: DEFAULT_BRAND_TOKENS, tone: DEFAULT_TONE_RULES, compliance: DEFAULT_COMPLIANCE_RULES, defaultTemplateId: "tpl_authority_001" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tk = b.tokens;
  const setTokens = (fn: (t: BrandTokens) => void) => setB((prev) => { const n = structuredClone(prev); fn(n.tokens); return n; });

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body = { name: b.name, brandTokens: b.tokens, toneRules: b.tone, complianceRules: b.compliance, defaultTemplateId: b.defaultTemplateId };
      if (b.id) {
        await api(`/api/brands/${b.id}`, { method: "PATCH", body });
        setMsg("Marca atualizada.");
        router.refresh();
      } else {
        const res = await api<{ id: string }>("/api/brands", { body, idempotent: true });
        router.push(`/brands/${res.id}`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined, purpose: "brand_logo" | "brand_music" | "brand_font") {
    if (!file || !b.id) return;
    setError(null);
    try {
      const res = await uploadFile(file, { brandId: b.id, purpose }, () => undefined);
      if (purpose === "brand_logo") setTokens((t) => (t.logo.defaultAssetId = res.assetId));
      setMsg(`${file.name} enviado (sha256 ${res.checksum.slice(0, 10)}…). ${purpose === "brand_logo" ? "Salve para definir como logo padrão." : ""}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <fieldset disabled={!canManage} className="grid gap-4 lg:grid-cols-2">
      <Card title="Identidade">
        <div className="flex flex-col gap-3">
          <Field label="Nome da marca"><Input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BRAND_COLOR_ROLES.map((role) => (
              <Field key={role} label={role}>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={`cor ${role}`} value={tk.colors[role].slice(0, 7)} onChange={(e) => setTokens((t) => (t.colors[role] = e.target.value.toUpperCase()))} className="h-10 w-12 rounded border border-ink-600 bg-transparent" />
                  <span className="font-mono text-xs">{tk.colors[role]}</span>
                </div>
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fonte de títulos"><Input value={tk.typography.heading} onChange={(e) => setTokens((t) => (t.typography.heading = e.target.value))} /></Field>
            <Field label="Fonte de texto"><Input value={tk.typography.body} onChange={(e) => setTokens((t) => (t.typography.body = e.target.value))} /></Field>
          </div>
          <p className="text-xs text-ink-400">Inter está incluída. Outras famílias exigem upload do arquivo da fonte — renders com fonte ausente falham explicitamente.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estilo de motion">
              <Select value={tk.motion.style} onChange={(e) => setTokens((t) => (t.motion.style = e.target.value as BrandTokens["motion"]["style"]))}>
                <option value="clean-cinematic">clean-cinematic</option><option value="energetic">energetic</option><option value="minimal">minimal</option><option value="corporate">corporate</option>
              </Select>
            </Field>
            <Field label="Máx. animações por cena"><Input type="number" value={tk.motion.maxAnimationsPerScene} onChange={(e) => setTokens((t) => (t.motion.maxAnimationsPerScene = Number(e.target.value)))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rodapé"><Input value={tk.footer.text} onChange={(e) => setTokens((t) => (t.footer.text = e.target.value))} /></Field>
            <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" checked={tk.footer.enabled} onChange={(e) => setTokens((t) => (t.footer.enabled = e.target.checked))} /> exibir rodapé</label>
          </div>
          <Field label="Template padrão">
            <Select value={b.defaultTemplateId} onChange={(e) => setB({ ...b, defaultTemplateId: e.target.value })}>
              {templates.filter((t) => t.status !== "planned").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="Legendas, logo e áudio">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Linhas máximas"><Input type="number" min={1} max={3} value={tk.captions.maxLines} onChange={(e) => setTokens((t) => (t.captions.maxLines = Number(e.target.value)))} /></Field>
          <Field label="Caracteres por linha"><Input type="number" value={tk.captions.maxCharsPerLine} onChange={(e) => setTokens((t) => (t.captions.maxCharsPerLine = Number(e.target.value)))} /></Field>
          <Field label="Área segura inferior (%)"><Input type="number" value={tk.captions.safeBottomPercent} onChange={(e) => setTokens((t) => (t.captions.safeBottomPercent = Number(e.target.value)))} /></Field>
          <Field label="Peso da legenda"><Input type="number" step={100} value={tk.typography.captionWeight} onChange={(e) => setTokens((t) => (t.typography.captionWeight = Number(e.target.value)))} /></Field>
          <Field label="Logo: largura mínima (%)"><Input type="number" value={tk.logo.minWidthPercent} onChange={(e) => setTokens((t) => (t.logo.minWidthPercent = Number(e.target.value)))} /></Field>
          <Field label="Logo: posição">
            <Select value={tk.logo.position} onChange={(e) => setTokens((t) => (t.logo.position = e.target.value as BrandTokens["logo"]["position"]))}>
              <option value="top-right">topo direita</option><option value="top-left">topo esquerda</option><option value="bottom-right">base direita</option><option value="bottom-left">base esquerda</option>
            </Select>
          </Field>
          <Field label="Loudness alvo (LUFS)"><Input type="number" value={tk.audio.targetLufs} onChange={(e) => setTokens((t) => (t.audio.targetLufs = Number(e.target.value)))} /></Field>
          <Field label="Volume da trilha"><Input type="number" step={0.01} value={tk.audio.musicVolume} onChange={(e) => setTokens((t) => (t.audio.musicVolume = Number(e.target.value)))} /></Field>
        </div>
        {b.id ? (
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <Field label="Enviar logotipo (PNG/JPG/WebP)"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0], "brand_logo")} /></Field>
            <Field label="Enviar trilha licenciada"><input type="file" accept="audio/*" onChange={(e) => upload(e.target.files?.[0], "brand_music")} /></Field>
            <Field label="Enviar fonte (WOFF2/TTF/OTF)"><input type="file" accept=".woff2,.woff,.ttf,.otf" onChange={(e) => upload(e.target.files?.[0], "brand_font")} /></Field>
            <ul className="flex flex-wrap gap-2">
              {b.assets?.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded border border-ink-700 p-1.5 text-xs">
                  {a.type === "logo" && <img src={a.url} alt="logo" className="h-8 max-w-24 object-contain" />}
                  <Badge tone={a.id === tk.logo.defaultAssetId ? "ok" : "neutral"}>{a.type}{a.id === tk.logo.defaultAssetId ? " padrão" : ""}</Badge>
                  <span>{String(a.metadata.originalName ?? a.id)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-400">Salve a marca para enviar logotipo, trilha e fontes.</p>
        )}
      </Card>
      <Card title="Tom de voz">
        <div className="flex flex-col gap-3">
          <Field label="Voz da marca"><Textarea value={b.tone.voice} onChange={(e) => setB({ ...b, tone: { ...b.tone, voice: e.target.value } })} /></Field>
          <Field label="Palavras proibidas (vírgula)"><Input value={b.tone.forbiddenWords.join(", ")} onChange={(e) => setB({ ...b, tone: { ...b.tone, forbiddenWords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} /></Field>
          <Field label="Hashtags (vírgula)"><Input value={b.tone.hashtags.join(", ")} onChange={(e) => setB({ ...b, tone: { ...b.tone, hashtags: e.target.value.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean) } })} /></Field>
        </div>
      </Card>
      <Card title="Compliance">
        <div className="flex flex-col gap-3">
          <Field label="Setor">
            <Select value={b.compliance.sector} onChange={(e) => setB({ ...b, compliance: { ...b.compliance, sector: e.target.value as ComplianceRules["sector"] } })}>
              {["general", "health", "finance", "education", "food", "real_estate", "public_sector"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Termos proibidos (vírgula)"><Input value={b.compliance.prohibitedTerms.join(", ")} onChange={(e) => setB({ ...b, compliance: { ...b.compliance, prohibitedTerms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} /></Field>
          <Field label="Aviso obrigatório (opcional)"><Input value={b.compliance.requiredDisclaimer ?? ""} onChange={(e) => setB({ ...b, compliance: { ...b.compliance, requiredDisclaimer: e.target.value || null } })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.compliance.blockOnHighSeverity} onChange={(e) => setB({ ...b, compliance: { ...b.compliance, blockOnHighSeverity: e.target.checked } })} /> bloquear em alertas de severidade alta até decisão humana</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.compliance.allowPersonalData} onChange={(e) => setB({ ...b, compliance: { ...b.compliance, allowPersonalData: e.target.checked } })} /> dados pessoais autorizados (consentimento registrado)</label>
        </div>
      </Card>
      <div className="flex items-center gap-3 lg:col-span-2">
        <Button variant="primary" onClick={save} disabled={busy || b.name.length < 2} data-testid="save-brand">{busy ? "Salvando…" : b.id ? "Salvar marca" : "Criar marca"}</Button>
        {msg && <span className="text-sm text-ok-500">{msg}</span>}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </fieldset>
  );
}
