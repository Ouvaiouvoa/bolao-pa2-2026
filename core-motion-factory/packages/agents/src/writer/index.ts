import { z } from "zod";
import type { BriefContent, CreativeDirection, Script, ScriptBeat, ScriptVariant, SelectCandidate, Selects } from "@cmf/schemas";
import { capitalize, contentStems, hasNumber, headlineFrom, tokenize } from "../core/text";
import { AgentFailure, type AgentModule } from "../core/types";

function beatFrom(c: SelectCandidate, kind: ScriptBeat["kind"], i: number): ScriptBeat {
  return { id: `beat_${String(i + 1).padStart(2, "0")}`, kind, selectId: c.id, assetId: c.assetId, startMs: c.startMs, endMs: c.endMs, text: c.text, onScreenText: null };
}

/** Short on-screen label for a body beat (ordinals and numbers become callouts). */
export function calloutFor(text: string): string | null {
  const n = tokenize(text);
  const ord = n.find((w) => ["primeiro", "segundo", "terceiro", "quarto", "quinto"].includes(w));
  if (ord) {
    const idx = ["primeiro", "segundo", "terceiro", "quarto", "quinto"].indexOf(ord) + 1;
    const after = text.split(/\s+(?:é|são|foi)\s+|:/i)[1]?.trim().replace(/[.!?]$/, "");
    const label = after ? headlineFrom(capitalize(after), 5).replace(/…$/, "") : "";
    return label ? `${idx}. ${label}` : `#${idx}`;
  }
  if (hasNumber(text) && tokenize(text).length <= 18) return headlineFrom(text, 6).replace(/…$/, "");
  return null;
}

function emphasisFor(title: string, keywords: string[]): string[] {
  const words = title.replace(/[.,!?…]/g, "").split(/\s+/);
  const picks = words.filter((w) => /\d/.test(w) || keywords.includes(contentStems(w)[0] ?? "~"));
  return [...new Set(picks)].slice(0, 2);
}

export function buildVariant(id: "A" | "B", hook: SelectCandidate, selects: Selects, brief: BriefContent, dir: CreativeDirection): ScriptVariant {
  const chosen = selects.candidates.filter((c) => c.selected && c.id !== hook.id);
  const cta = chosen.find((c) => c.role === "cta");
  const body = chosen.filter((c) => c !== cta).sort((a, b) => a.assetId.localeCompare(b.assetId) || a.startMs - b.startMs);
  const beats: ScriptBeat[] = [];
  beats.push(beatFrom(hook, "hook", beats.length));
  for (const c of body) {
    const b = beatFrom(c, hasNumber(c.text) ? "proof" : "body", beats.length);
    b.onScreenText = calloutFor(c.text);
    beats.push(b);
  }
  if (cta) beats.push({ ...beatFrom(cta, "cta", beats.length), onScreenText: brief.cta.text });
  else beats.push({ id: `beat_${String(beats.length + 1).padStart(2, "0")}`, kind: "cta", selectId: null, assetId: null, startMs: null, endMs: null, text: brief.cta.text, onScreenText: brief.cta.text });
  const hookTitle = (brief.headline ?? headlineFrom(hook.text, 9)).slice(0, 90);
  const speechMs = beats.reduce((n, b) => n + (b.endMs !== null && b.startMs !== null ? b.endMs - b.startMs : 0), 0);
  return {
    id,
    hookTitle,
    hookEmphasis: emphasisFor(hookTitle, dir.keywords),
    beats,
    ctaText: brief.cta.text,
    estimatedDurationSec: Math.round(speechMs / 100) / 10 + (cta ? 0 : 3),
    rationale: `Gancho "${hook.text.slice(0, 80)}" (potencial ${hook.hookPotential}); ${body.length} beat(s) em ordem cronológica para preservar o raciocínio; CTA ${cta ? "falado pelo apresentador" : "em cartela final"}.`,
  };
}

const LlmCopy = z.object({
  hookTitle: z.string().min(4).max(80),
  publishCaption: z.string().min(20).max(1500),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(8),
});

/** Agente Roteirista (6.5): narrative, hook, progression and CTA; optional A/B. */
export const writerAgent: AgentModule = {
  type: "writer",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const selects = await ctx.tools.readArtifact("selects");
    const brief = await ctx.tools.readProjectBrief();
    const rejections = (await ctx.tools.listApprovals()).filter((a) => a.artifactType === "script" && a.decision === "rejected").length;
    return { refs: [...(selects ? [{ kind: "selects", id: selects.id, version: selects.version }] : []), { kind: "brief", id: brief.briefId, version: brief.version }], params: { rejections, llm: Boolean(ctx.llm) } };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo briefing, direção e selects", "reading_inputs");
    const brief = (await ctx.tools.readProjectBrief()).content;
    const brand = await ctx.tools.readBrandTokens();
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    const selects = await ctx.tools.readArtifact<Selects>("selects");
    if (!dir || !selects) throw new AgentFailure("MISSING_INPUTS", "direção criativa ou selects ausentes");
    const pool = selects.payload.candidates.filter((c) => !c.rejectedReason);
    const hooks = [...pool].sort((a, b) => b.hookPotential + b.scores.total * 0.5 - (a.hookPotential + a.scores.total * 0.5));
    if (!hooks.length) throw new AgentFailure("NO_HOOK", "nenhum trecho disponível para gancho");
    // Each script rejection rotates the hook choice so the human gets a genuinely different option.
    const rejections = (await ctx.tools.listApprovals()).filter((a) => a.artifactType === "script" && a.decision === "rejected").length;
    const primary = hooks[rejections % hooks.length]!;
    await ctx.progress(0.4, "estruturando gancho, progressão e CTA");
    const variants: ScriptVariant[] = [buildVariant("A", primary, selects.payload, brief, dir.payload)];
    if (brief.variantsAB && hooks.length > 1) variants.push(buildVariant("B", hooks[(rejections + 1) % hooks.length]!, selects.payload, brief, dir.payload));
    const keyTags = brief.keywords.slice(0, 3).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, "")}`);
    let hashtags = [...new Set([...brand.tone.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)), ...keyTags])].slice(0, 8);
    const body = variants[0]!.beats.filter((b) => b.kind === "body" || b.kind === "proof").slice(0, 2).map((b) => b.text);
    let publishCaption = [variants[0]!.hookTitle, "", ...body, "", `👉 ${brief.cta.text}${brief.cta.url ? ` ${brief.cta.url}` : ""}`, "", hashtags.join(" ")].join("\n").trim();
    let model = "heuristic-v1";
    if (ctx.llm) {
      await ctx.progress(0.6, "refinando título e legenda de publicação com modelo de linguagem");
      try {
        const res = await ctx.llm.generateObject({
          tier: "default",
          effort: "low",
          system: "Você é roteirista de vídeos curtos da marca. Escreva em português do Brasil, sem promessas absolutas, sem inventar fatos que não estejam nas falas fornecidas.",
          schema: LlmCopy,
          prompt: [
            `Objetivo: ${brief.goalStatement}`,
            `Tom da marca: ${brand.tone.voice || "claro e direto"}; palavras proibidas: ${brand.tone.forbiddenWords.join(", ") || "nenhuma"}`,
            `Falas aprovadas (use apenas estas informações):\n${variants[0]!.beats.map((b) => `- ${b.text}`).join("\n")}`,
            `CTA obrigatório: ${brief.cta.text}`,
            "Gere: hookTitle (até 9 palavras), publishCaption (legenda do post) e até 8 hashtags.",
          ].join("\n"),
        });
        ctx.recordUsage(res.usage);
        const forbidden = brand.tone.forbiddenWords.map((w) => w.toLowerCase());
        const clean = (s: string) => !forbidden.some((w) => s.toLowerCase().includes(w));
        if (clean(res.data.hookTitle) && clean(res.data.publishCaption)) {
          variants[0]!.hookTitle = res.data.hookTitle;
          publishCaption = res.data.publishCaption;
          hashtags = res.data.hashtags.length ? res.data.hashtags : hashtags;
          model = res.usage.model;
        }
      } catch (err) {
        ctx.log("LLM indisponível; mantendo roteiro determinístico", { error: (err as Error).message });
      }
    }
    const script: Script = { variants, chosenVariant: "A", publishCaption, hashtags };
    await ctx.progress(0.9, "registrando roteiro", "writing_outputs");
    const art = await ctx.tools.createArtifact("script", script);
    return {
      summary: `roteiro com ${variants[0]!.beats.length} beats${variants.length > 1 ? " e variante B" : ""}; gancho: "${variants[0]!.hookTitle}"`,
      outputRefs: [{ type: "script", id: art.id, version: art.version }],
      model,
    };
  },
};
