import { z } from "zod";
import { findTrack, frameToMs, type ComplianceFinding, type ComplianceReport, type ComplianceRules, type EditPlan, type TranscriptPayload } from "@cmf/schemas";
import { timelineWords } from "../captions";
import { normalize } from "../core/text";
import { planPartsHash } from "../core/hash";
import { AgentFailure, type AgentModule } from "../core/types";
import { onScreenTexts } from "../brand";

interface Rule {
  id: string;
  category: ComplianceFinding["category"];
  pattern: RegExp;
  severity: (sector: ComplianceRules["sector"]) => ComplianceFinding["severity"];
  suggestion: string;
}

const RULES: Rule[] = [
  { id: "ABS-GARANTIA", category: "absolute_promise", pattern: /\b(resultado garantido|garantido|garantia de resultado|garanto)\b/, severity: () => "high", suggestion: "remova a promessa de garantia ou qualifique com condições verificáveis" },
  { id: "ABS-100", category: "absolute_promise", pattern: /(\b100 ?%|\bcem por cento\b)/, severity: () => "high", suggestion: "evite percentuais absolutos sem comprovação" },
  { id: "ABS-RISCO", category: "absolute_promise", pattern: /\b(sem (nenhum )?risco|risco zero|nunca falha|infalivel)\b/, severity: () => "high", suggestion: "não afirme ausência total de risco" },
  { id: "ABS-MILAGRE", category: "absolute_promise", pattern: /\b(milagre|milagroso|definitivo|para sempre)\b/, severity: () => "medium", suggestion: "linguagem absoluta; prefira termos mensuráveis" },
  { id: "SENS-SAUDE", category: "sensitive_claim", pattern: /\b(cura|curar|tratamento|emagrec\w*|remedio|doenca|diagnostico)\b/, severity: (s) => (s === "health" ? "high" : "medium"), suggestion: "alegação de saúde exige respaldo técnico e revisão" },
  { id: "SENS-FIN", category: "sensitive_claim", pattern: /\b(lucro|rentabilidade|renda extra|enriquec\w*|fique rico|retorno garantido|investimento)\b/, severity: (s) => (s === "finance" ? "high" : "medium"), suggestion: "alegação financeira exige aviso de risco e revisão" },
];

const PERSONAL: { id: string; pattern: RegExp; label: string }[] = [
  { id: "PD-CPF", pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, label: "CPF" },
  { id: "PD-FONE", pattern: /\b(\(?\d{2}\)?\s?)?9?\d{4}-?\d{4}\b/, label: "telefone" },
  { id: "PD-EMAIL", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, label: "e-mail" },
  { id: "PD-CEP", pattern: /\b\d{5}-\d{3}\b/, label: "CEP" },
];

export interface ComplianceSource {
  source: ComplianceFinding["source"];
  text: string;
  atMs: number | null;
}

/** Deterministic compliance scan (section 6.11). Pure — unit tested. */
export function scanCompliance(sources: ComplianceSource[], rules: ComplianceRules, extra: { musicOrigins: (string | null)[]; disclaimerOnScreen: boolean }): ComplianceReport {
  const findings: ComplianceFinding[] = [];
  let n = 0;
  const push = (f: Omit<ComplianceFinding, "id">) => {
    const dup = findings.find((x) => x.rule === f.rule && x.source === f.source && x.text === f.text);
    if (!dup) findings.push({ ...f, id: `cf_${String(++n).padStart(3, "0")}` });
  };
  for (const s of sources) {
    const norm = normalize(s.text);
    for (const r of RULES) if (r.pattern.test(norm)) push({ severity: r.severity(rules.sector), category: r.category, text: s.text.slice(0, 200), source: s.source, atMs: s.atMs, rule: r.id, suggestion: r.suggestion });
    for (const term of rules.prohibitedTerms) {
      if (norm.includes(normalize(term))) push({ severity: "high", category: "prohibited_term", text: s.text.slice(0, 200), source: s.source, atMs: s.atMs, rule: `TERMO:${term}`, suggestion: `remova o termo proibido "${term}"` });
    }
    if (!rules.allowPersonalData) {
      for (const p of PERSONAL) {
        if (p.pattern.test(s.text)) push({ severity: "high", category: "personal_data", text: s.text.slice(0, 200), source: s.source, atMs: s.atMs, rule: p.id, suggestion: `oculte o ${p.label} ou obtenha autorização registrada` });
      }
    }
  }
  if (rules.requiredDisclaimer && !extra.disclaimerOnScreen)
    push({ severity: "medium", category: "missing_disclaimer", text: rules.requiredDisclaimer, source: "on_screen", atMs: null, rule: "DISCLAIMER", suggestion: "inclua o aviso obrigatório do setor na tela" });
  for (const origin of extra.musicOrigins) {
    if (!origin || origin.trim().length < 3) push({ severity: "medium", category: "media_origin", text: "trilha sem origem registrada", source: "audio", atMs: null, rule: "ORIGEM-AUDIO", suggestion: "registre licença/origem da trilha" });
  }
  const order = ["none", "info", "low", "medium", "high"] as const;
  const highestSeverity = findings.reduce<(typeof order)[number]>((acc, f) => (order.indexOf(f.severity) > order.indexOf(acc) ? f.severity : acc), "none");
  const requiresHumanDecision = rules.blockOnHighSeverity && highestSeverity === "high";
  return { ok: highestSeverity !== "high", highestSeverity, findings, requiresHumanDecision, checkedSources: [...new Set(sources.map((s) => s.source))] };
}

const LlmFindings = z.object({
  findings: z
    .array(
      z.object({
        text: z.string().max(200),
        category: z.enum(["absolute_promise", "sensitive_claim", "personal_data", "prohibited_term", "sector_rule"]),
        severity: z.enum(["low", "medium", "high"]),
        suggestion: z.string().max(300),
      }),
    )
    .max(12),
});

/** Agente Compliance (6.11): high alerts block progress until a human decides. */
export const complianceAgent: AgentModule = {
  type: "compliance",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    const brand = await ctx.tools.readBrandTokens();
    const script = await ctx.tools.readArtifact("script");
    return {
      refs: [...(plan ? [{ kind: "edit_plan", id: "content", checksum: planPartsHash(plan.plan, ["all"]) }] : []), ...(script ? [{ kind: "script", id: script.id, version: script.version }] : [])],
      params: { rules: brand.compliance, llm: Boolean(ctx.llm) },
    };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo regras do setor, roteiro e composição", "reading_inputs");
    const current = await ctx.tools.readEditPlan();
    if (!current) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const brand = await ctx.tools.readBrandTokens();
    const plan: EditPlan = current.plan;
    const fps = plan.composition.fps;
    const transcripts = new Map<string, TranscriptPayload>();
    for (const a of await ctx.tools.listProjectAssets()) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.set(a.id, t);
    }
    // Spoken content actually used in the timeline, grouped by sentence.
    const words = timelineWords(plan, transcripts);
    const spoken: ComplianceSource[] = [];
    let buf: typeof words = [];
    for (const w of words) {
      buf.push(w);
      if (/[.!?…]$/.test(w.text)) {
        spoken.push({ source: "transcript", text: buf.map((x) => x.text).join(" "), atMs: Math.round(frameToMs(buf[0]!.startFrame, fps)) });
        buf = [];
      }
    }
    if (buf.length) spoken.push({ source: "transcript", text: buf.map((x) => x.text).join(" "), atMs: Math.round(frameToMs(buf[0]!.startFrame, fps)) });
    const screen = onScreenTexts(plan)
      .filter((t) => t.kind !== "caption")
      .map((t) => ({ source: "on_screen" as const, text: t.text, atMs: Math.round(frameToMs(t.fromFrame, fps)) }));
    const script = await ctx.tools.readArtifact<{ publishCaption: string }>("script");
    const copy: ComplianceSource[] = script ? [{ source: "script", text: script.payload.publishCaption, atMs: null }] : [];
    const audio = findTrack(plan, "audio")?.items ?? [];
    const disclaimer = brand.compliance.requiredDisclaimer;
    await ctx.progress(0.4, "verificando alegações, dados pessoais e termos proibidos");
    const report = scanCompliance([...spoken, ...screen, ...copy], brand.compliance, {
      musicOrigins: audio.map((a) => a.origin),
      disclaimerOnScreen: disclaimer ? screen.some((s) => normalize(s.text).includes(normalize(disclaimer))) : true,
    });
    let model = "heuristic-v1";
    if (ctx.llm) {
      await ctx.progress(0.6, "revisão semântica complementar (modelo pequeno)");
      try {
        const res = await ctx.llm.generateObject({
          tier: "small",
          effort: "low",
          system: "Você é revisor de compliance publicitário no Brasil (CONAR, LGPD). Liste apenas problemas reais presentes no texto, citando o trecho exato.",
          schema: LlmFindings,
          prompt: `Setor: ${brand.compliance.sector}\nTextos:\n${[...spoken, ...screen, ...copy].map((s) => `[${s.source}@${s.atMs ?? "-"}] ${s.text}`).join("\n")}`,
        });
        ctx.recordUsage(res.usage);
        const all = [...spoken, ...screen, ...copy];
        for (const f of res.data.findings) {
          const src = all.find((s) => normalize(s.text).includes(normalize(f.text).slice(0, 40)));
          if (!src) continue; // the model may only flag text that really exists
          report.findings.push({ id: `cf_llm_${report.findings.length + 1}`, severity: f.severity, category: f.category, text: f.text, source: src.source, atMs: src.atMs, rule: "LLM-REVISAO", suggestion: f.suggestion });
        }
        const order = ["none", "info", "low", "medium", "high"] as const;
        report.highestSeverity = report.findings.reduce<(typeof order)[number]>((acc, f) => (order.indexOf(f.severity) > order.indexOf(acc) ? f.severity : acc), "none");
        report.ok = report.highestSeverity !== "high";
        report.requiresHumanDecision = brand.compliance.blockOnHighSeverity && report.highestSeverity === "high";
        model = res.usage.model;
      } catch (err) {
        ctx.log("LLM indisponível; mantendo verificação determinística", { error: (err as Error).message });
      }
    }
    const art = await ctx.tools.createArtifact("compliance_report", report);
    return {
      summary: report.findings.length ? `${report.findings.length} alerta(s), severidade máxima ${report.highestSeverity}${report.requiresHumanDecision ? " — requer decisão humana" : ""}` : "nenhum alerta de compliance",
      outputRefs: [{ type: "compliance_report", id: art.id, version: art.version }],
      model,
    };
  },
};
