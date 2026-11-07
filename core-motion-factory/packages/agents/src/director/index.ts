import { z } from "zod";
import { motionProfile } from "@cmf/brand-engine";
import { ASPECT_DIMENSIONS, OBJECTIVE_LABELS, type CreativeDirection } from "@cmf/schemas";
import { isSelectable, layoutFor, templateForObjective } from "@cmf/templates";
import { contentStems } from "../core/text";
import type { AgentModule } from "../core/types";

/** Section 17 — base prompt of the production orchestrator, used when LLM assistance is enabled. */
export const DIRECTOR_SYSTEM_PROMPT = `Você é o Diretor de Produção do CORE Motion Factory.

Sua função é transformar o briefing aprovado em uma sequência de tarefas
verificáveis. Use apenas ferramentas autorizadas. Delegue trabalhos fechados
a especialistas e exija saídas estruturadas. Nunca declare uma etapa concluída
sem artefato persistido e validado.

Prioridades:
1. intenção do cliente;
2. segurança e compliance;
3. identidade da marca;
4. clareza narrativa;
5. qualidade técnica;
6. custo e velocidade.

Pare e solicite decisão humana quando houver:
- alegação sensível;
- material ambíguo;
- conflito entre briefing e regras de marca;
- custo acima do limite;
- baixa confiança em transcrição crítica;
- necessidade de publicar ou transmitir conteúdo.

Não crie agentes adicionais sem necessidade. Não permita loops indefinidos.
Finalize cada execução com status, artefatos, métricas e próxima ação.`;

const LlmDirection = z.object({
  hookStrategy: z.string().min(10).max(400),
  risks: z.array(z.string().min(5).max(300)).max(8),
  rationale: z.string().min(20).max(1200),
});

/**
 * Agente Diretor (6.1): interprets the brief against the material and brand, decides
 * template/format/pacing, defines acceptance criteria and the task plan. Never approves output.
 */
export const directorAgent: AgentModule = {
  type: "director",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const brief = await ctx.tools.readProjectBrief();
    const assets = await ctx.tools.listProjectAssets();
    const refs: { kind: string; id: string; version?: number; checksum?: string }[] = [{ kind: "brief", id: brief.briefId, version: brief.version }];
    for (const a of assets.filter((x) => x.status === "ready")) {
      const t = await ctx.tools.readTranscript(a.id);
      refs.push({ kind: "asset", id: a.id, checksum: a.checksum ?? "" });
      if (t) refs.push({ kind: "transcript", id: t.transcriptId, version: t.version });
    }
    const brand = await ctx.tools.readBrandTokens();
    refs.push({ kind: "brand", id: brand.brandId, checksum: JSON.stringify(brand.tokens).length.toString() });
    return { refs, params: { templateId: brief.templateId, llm: Boolean(ctx.llm) } };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo briefing aprovado", "reading_inputs");
    const brief = await ctx.tools.readProjectBrief();
    const brand = await ctx.tools.readBrandTokens();
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready" && a.type !== "music");
    await ctx.progress(0.25, "analisando material disponível");
    let speechMs = 0;
    let words = 0;
    let lowConf = 0;
    let language: string | null = null;
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (!t) continue;
      language = t.language;
      words += t.words.length;
      lowConf += t.words.filter((w) => w.confidence !== null && w.confidence < 0.6).length;
      speechMs += t.segments.reduce((n, s) => n + (s.endMs - s.startMs), 0);
    }
    const b = brief.content;
    const templateId = isSelectable(brief.templateId) ? brief.templateId : templateForObjective(b.objective).id;
    const template = await ctx.tools.readTemplate(templateId);
    const aspect = b.formats[0] ?? "9:16";
    const layout = layoutFor(template, aspect);
    const dims = ASPECT_DIMENSIONS[aspect];
    const ideal = Math.round(Math.min(b.durationTargetSec.max, Math.max(b.durationTargetSec.min, (b.durationTargetSec.min + b.durationTargetSec.max) / 2)));
    const profile = motionProfile(brand.tokens.motion.style);
    const keywordStems = [...new Set([...b.keywords.flatMap((k) => contentStems(k)), ...contentStems(b.goalStatement), ...b.keyMessages.flatMap((m) => contentStems(m))])].slice(0, 25);

    const risks: string[] = [];
    if (!words) risks.push("material sem fala reconhecida — o roteiro dependerá apenas de textos na tela");
    if (lowConf > 0) risks.push(`${lowConf} palavra(s) com baixa confiança na transcrição — revisar antes de aprovar o roteiro`);
    if (speechMs / 1000 < b.durationTargetSec.min) risks.push(`fala útil (${Math.round(speechMs / 1000)}s) é menor que a duração mínima pedida (${b.durationTargetSec.min}s)`);
    const landscape = assets.some((a) => a.width && a.height && a.width > a.height);
    if (landscape && aspect === "9:16") risks.push("material horizontal será reenquadrado para 9:16 (corte lateral); verifique o enquadramento no preview");
    if (brand.compliance.sector !== "general") risks.push(`setor regulado (${brand.compliance.sector}): compliance terá regras adicionais`);
    for (const r of b.restrictions) risks.push(`restrição do briefing: ${r}`);

    const acceptanceCriteria = [
      { id: "AC-HOOK", description: "Gancho visível nos 3 primeiros segundos", check: "hook_title em frame 0 ou primeira fala com potencial de gancho" },
      { id: "AC-DURATION", description: `Duração entre ${b.durationTargetSec.min}s e ${b.durationTargetSec.max}s`, check: "duração do master" },
      { id: "AC-CTA", description: `CTA "${b.cta.text}" presente no final`, check: "item cta com headline igual ao briefing" },
      { id: "AC-CAPTIONS", description: `Legendas com até ${brand.tokens.captions.maxLines} linhas e área segura inferior`, check: "validação do edit plan" },
      { id: "AC-BRAND", description: "Cores, fontes, logo e rodapé conforme kit da marca", check: "brand_report sem bloqueios" },
      { id: "AC-COMPLIANCE", description: "Alegações sensíveis sinalizadas e decididas por humano", check: "compliance_report + aprovação" },
      { id: "AC-TECH", description: `${dims.width}×${dims.height} H.264/AAC, loudness ${brand.tokens.audio.targetLufs} LUFS`, check: "QA técnico" },
    ];
    const renderEstimate = (ideal / 60) * Number(process.env.CMF_RENDER_CENTS_PER_MINUTE ?? 4);
    const llmEstimate = ctx.llm ? 2 : 0;
    const tasks = [
      { agent: "curator", description: "selecionar melhores trechos com justificativa", estimatedCostCents: llmEstimate * 0.2 },
      { agent: "writer", description: "gancho, progressão e CTA" + (b.variantsAB ? " (variantes A/B)" : ""), estimatedCostCents: llmEstimate },
      { agent: "editor", description: `timeline ${aspect} com jump cuts (pausas > ${template.pacing.removePausesOverMs}ms)`, estimatedCostCents: 0 },
      { agent: "captions", description: `legendas ${template.captionPreset}, até ${brand.tokens.captions.maxCharsPerLine} caracteres/linha`, estimatedCostCents: 0 },
      { agent: "motion", description: `motion ${profile.intensity}: gancho, lower third, destaques e CTA`, estimatedCostCents: 0 },
      { agent: "audio", description: `normalização para ${brand.tokens.audio.targetLufs} LUFS, trilha com ducking`, estimatedCostCents: 0 },
      { agent: "brand", description: "verificação de identidade", estimatedCostCents: 0 },
      { agent: "compliance", description: `regras do setor ${brand.compliance.sector}`, estimatedCostCents: llmEstimate * 0.1 },
      { agent: "render", description: "preview 540p + master 1080p", estimatedCostCents: renderEstimate * 1.3 },
      { agent: "qa", description: "QA técnico, editorial, marca e compliance", estimatedCostCents: 0 },
    ];
    let hookStrategy = b.headline
      ? `usar o título do briefing "${b.headline}" sobre a fala de maior potencial de gancho`
      : "abrir com a fala de maior potencial de gancho (pergunta, número ou contraste) e título tipográfico derivado dela";
    let rationale = `${OBJECTIVE_LABELS[b.objective]} para ${b.channel} em ${aspect}. Template "${template.name}" com ritmo de cortes em pausas acima de ${template.pacing.removePausesOverMs}ms. Duração ideal ${ideal}s a partir de ${Math.round(speechMs / 1000)}s de fala útil.`;
    let model = "heuristic-v1";

    if (ctx.llm) {
      await ctx.progress(0.6, "refinando estratégia com modelo de linguagem");
      try {
        const res = await ctx.llm.generateObject({
          tier: "default",
          effort: "medium",
          system: DIRECTOR_SYSTEM_PROMPT,
          schema: LlmDirection,
          prompt: [
            "Defina a estratégia de gancho, riscos e justificativa para este vídeo. Responda em português.",
            `Briefing: ${JSON.stringify(b)}`,
            `Marca: ${brand.name}; tom: ${brand.tone.voice || "não definido"}; setor: ${brand.compliance.sector}`,
            `Template: ${template.name} (${aspect}); duração ideal ${ideal}s; fala útil ${Math.round(speechMs / 1000)}s; palavras ${words}; baixa confiança ${lowConf}`,
            `Riscos já detectados: ${risks.join("; ") || "nenhum"}`,
          ].join("\n"),
        });
        ctx.recordUsage(res.usage);
        hookStrategy = res.data.hookStrategy;
        rationale = res.data.rationale;
        for (const r of res.data.risks) if (!risks.includes(r)) risks.push(r);
        model = res.usage.model;
      } catch (err) {
        ctx.log("LLM indisponível; mantendo direção determinística", { error: (err as Error).message });
      }
    }

    const direction: CreativeDirection = {
      objective: b.objective,
      channel: b.channel,
      templateId,
      aspect,
      composition: { width: dims.width, height: dims.height, fps: 30 },
      targetDurationSec: { min: b.durationTargetSec.min, max: b.durationTargetSec.max, ideal },
      pacing: { removePausesOverMs: template.pacing.removePausesOverMs, cutPaddingMs: template.pacing.cutPaddingMs, punchInEveryNthCut: template.pacing.punchInEveryNthCut },
      captionPreset: template.captionPreset,
      motionIntensity: profile.intensity,
      hookStrategy,
      ctaText: b.cta.text,
      keywords: keywordStems,
      acceptanceCriteria,
      tasks,
      risks,
      materialSummary: { assets: assets.length, speechMs, words, language },
      rationale: `${rationale} Layout de legenda a ${layout.captionsBottomPercent}% da base.`,
    };
    await ctx.progress(0.9, "registrando direção criativa", "writing_outputs");
    const art = await ctx.tools.createArtifact("creative_direction", direction);
    return { summary: `direção criativa: ${template.name}, ${aspect}, ${ideal}s ideais, ${risks.length} risco(s)`, outputRefs: [{ type: "creative_direction", id: art.id, version: art.version }], model };
  },
};
