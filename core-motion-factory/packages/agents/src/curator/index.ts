import { readWavFloat32, rmsEnergy } from "@cmf/media";
import type { CreativeDirection, SelectCandidate, Selects, TranscriptPayload } from "@cmf/schemas";
import { contentStems, emotionScore, fillerRatio, hookScore, isCtaLike, isFalseStart, jaccard, tokenize } from "../core/text";
import { AgentFailure, type AgentModule } from "../core/types";

export interface CurationInput {
  transcripts: TranscriptPayload[];
  /** Per-asset RMS energy lookup (startMs,endMs) → 0..1 raw RMS; optional. */
  energy?: (assetId: string, startMs: number, endMs: number) => number;
  direction: Pick<CreativeDirection, "keywords" | "targetDurationSec">;
  /** Selects excluded by humans (e.g. compliance rejection): candidate time ranges to avoid. */
  avoidRanges?: { assetId: string; startMs: number; endMs: number }[];
}

const W = { clarity: 0.25, energy: 0.1, emotion: 0.1, completeness: 0.2, novelty: 0.15, adherence: 0.2 };
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Deterministic curation: scores every sentence on the six criteria of section 6.4,
 * detects false starts and retakes, then selects a hook, body and CTA that fit the target.
 * Pure function — unit tested.
 */
export function curate(input: CurationInput): Selects {
  const raw: (Omit<SelectCandidate, "scores" | "selected" | "role" | "reasons" | "rejectedReason" | "duplicateOf"> & { conf: number; stems: string[] })[] = [];
  for (const t of input.transcripts) {
    for (const s of t.segments) {
      const words = t.words.slice(s.wordStart, s.wordEnd + 1);
      const confs = words.map((w) => w.confidence ?? 0.85);
      raw.push({
        id: `sel_${t.assetId.slice(-6)}_${s.id}`,
        assetId: t.assetId,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        wordStart: s.wordStart,
        wordEnd: s.wordEnd,
        hookPotential: round(hookScore(s.text)),
        conf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.85,
        stems: contentStems(s.text),
      });
    }
  }
  if (!raw.length) return { candidates: [], selectedDurationMs: 0, summary: "nenhuma fala para curar" };
  const energies = raw.map((c) => (input.energy ? input.energy(c.assetId, c.startMs, c.endMs) : 0.1));
  const maxEnergy = Math.max(...energies, 1e-6);
  const keywordSet = new Set(input.direction.keywords);

  const candidates: SelectCandidate[] = raw.map((c, idx) => {
    const durSec = (c.endMs - c.startMs) / 1000;
    const nWords = tokenize(c.text).length;
    const wps = nWords / Math.max(0.3, durSec);
    const falseStart = isFalseStart(c.text);
    let clarity = c.conf * (1 - Math.min(0.6, fillerRatio(c.text) * 2));
    if (wps > 4.8 || wps < 1.2) clarity *= 0.8;
    if (falseStart) clarity *= 0.2;
    const energy = Math.min(1, energies[idx]! / maxEnergy);
    const emotion = emotionScore(c.text);
    let completeness = 0;
    if (/[.!?…]$/.test(c.text.trim())) completeness += 0.5;
    if (/^[\p{Lu}\d]/u.test(c.text.trim()) && !/^(e|mas|ou|porque|então)\b/i.test(c.text.trim())) completeness += 0.25;
    if (durSec >= 1.2 && durSec <= 20) completeness += 0.25;
    let maxSim = 0;
    raw.forEach((o, j) => {
      if (j !== idx) maxSim = Math.max(maxSim, jaccard(c.stems, o.stems));
    });
    const novelty = 1 - maxSim;
    const hits = c.stems.filter((s) => keywordSet.has(s)).length;
    const adherence = keywordSet.size ? Math.min(1, hits / Math.max(2, Math.min(5, c.stems.length * 0.5))) : 0.5;
    const total = W.clarity * clarity + W.energy * energy + W.emotion * emotion + W.completeness * completeness + W.novelty * novelty + W.adherence * adherence;
    const reasons: string[] = [];
    if (clarity >= 0.85) reasons.push("fala clara e com alta confiança de transcrição");
    if (emotion >= 0.3) reasons.push("carga emocional/intensidade");
    if (adherence >= 0.5) reasons.push("aderente às palavras-chave do briefing");
    if (c.hookPotential >= 0.5) reasons.push("bom potencial de gancho (pergunta/número/curiosidade)");
    if (completeness >= 0.99) reasons.push("frase completa");
    if (isCtaLike(c.text)) reasons.push("contém chamada para ação falada");
    return {
      id: c.id,
      assetId: c.assetId,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      wordStart: c.wordStart,
      wordEnd: c.wordEnd,
      scores: { clarity: round(clarity), energy: round(energy), emotion: round(emotion), completeness: round(completeness), novelty: round(novelty), adherence: round(adherence), total: round(total) },
      selected: false,
      role: null,
      hookPotential: c.hookPotential,
      reasons,
      rejectedReason: null,
      duplicateOf: null,
    };
  });

  // Retakes: near-identical sentences — keep the better (ties → the later take, usually the corrected one).
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (a.duplicateOf || b.duplicateOf) continue;
      if (jaccard(raw[i]!.stems, raw[j]!.stems) >= 0.7) {
        const keepB = b.scores.clarity + 0.02 >= a.scores.clarity;
        const drop = keepB ? a : b;
        const keep = keepB ? b : a;
        drop.duplicateOf = keep.id;
        drop.rejectedReason = `retake duplicado de ${keep.id} (mantida a tomada ${keepB ? "posterior" : "anterior"}, mais clara)`;
      }
    }
  }
  for (const c of candidates) {
    if (c.rejectedReason) continue;
    if (isFalseStart(c.text)) c.rejectedReason = "falso início / fala descartada pelo apresentador";
    else if (c.endMs - c.startMs < 800) c.rejectedReason = "trecho curto demais (< 0,8s)";
    else if (c.scores.clarity < 0.5) c.rejectedReason = "clareza insuficiente";
    else if (input.avoidRanges?.some((r) => r.assetId === c.assetId && r.startMs < c.endMs && r.endMs > c.startMs))
      c.rejectedReason = "excluído após decisão humana de compliance";
  }

  const pool = candidates.filter((c) => !c.rejectedReason);
  const targetMs = input.direction.targetDurationSec.ideal * 1000;
  const maxMs = input.direction.targetDurationSec.max * 1000;
  const hook = [...pool].sort((a, b) => b.hookPotential + b.scores.total * 0.5 - (a.hookPotential + a.scores.total * 0.5))[0];
  const cta = [...pool].reverse().find((c) => isCtaLike(c.text) && c !== hook);
  let used = 0;
  if (hook) {
    hook.selected = true;
    hook.role = "hook";
    used += hook.endMs - hook.startMs;
  }
  if (cta) {
    cta.selected = true;
    cta.role = "cta";
    used += cta.endMs - cta.startMs;
  }
  // Jump cuts compress pauses, so speech duration is a fair estimate of the edit length.
  const body = pool.filter((c) => !c.selected).sort((a, b) => b.scores.total - a.scores.total);
  for (const c of body) {
    const d = c.endMs - c.startMs;
    if (used + d > maxMs) {
      c.rejectedReason = "fora do tempo-alvo (prioridade menor)";
      continue;
    }
    if (used >= targetMs && c.scores.total < 0.6) {
      c.rejectedReason = "tempo-alvo já atingido";
      continue;
    }
    c.selected = true;
    c.role = "body";
    used += d;
  }
  const selected = candidates.filter((c) => c.selected);
  return {
    candidates,
    selectedDurationMs: used,
    summary: `${selected.length} de ${candidates.length} trechos selecionados (${(used / 1000).toFixed(1)}s de fala); ${candidates.filter((c) => c.duplicateOf).length} retake(s) e ${candidates.filter((c) => c.rejectedReason && !c.duplicateOf).length} descarte(s) justificados`,
  };
}

/** Agente Curador (6.4). */
export const curatorAgent: AgentModule = {
  type: "curator",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready");
    const refs: { kind: string; id: string; version?: number }[] = dir ? [{ kind: "creative_direction", id: dir.id, version: dir.version }] : [];
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) refs.push({ kind: "transcript", id: t.transcriptId, version: t.version });
    }
    const compliance = await ctx.tools.readArtifact("compliance_report");
    const rejected = (await ctx.tools.listApprovals()).filter((a) => a.artifactType === "compliance_report" && a.decision === "rejected").length;
    if (compliance && rejected) refs.push({ kind: "compliance_report", id: compliance.id, version: compliance.version });
    return { refs };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo direção criativa e transcrições", "reading_inputs");
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    if (!dir) throw new AgentFailure("MISSING_DIRECTION", "direção criativa ausente");
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready");
    const transcripts: TranscriptPayload[] = [];
    const signals = new Map<string, { samples: Float32Array; sampleRate: number }>();
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.push(t);
      const audioKey = a.metadata.audioKey as string | null;
      if (audioKey) signals.set(a.id, await readWavFloat32(await ctx.tools.materialize(audioKey)));
    }
    await ctx.progress(0.4, "pontuando trechos (clareza, energia, emoção, completude, novidade, aderência)");
    // Compliance rejection loop: avoid the time ranges with high-severity findings.
    const approvals = await ctx.tools.listApprovals();
    const avoidRanges: CurationInput["avoidRanges"] = [];
    if (approvals.some((a) => a.artifactType === "compliance_report" && a.decision === "rejected")) {
      const report = await ctx.tools.readArtifact<{ findings: { severity: string; atMs: number | null; source: string }[] }>("compliance_report");
      const plan = await ctx.tools.readEditPlan();
      for (const f of report?.payload.findings ?? []) {
        if (f.severity !== "high" || f.atMs === null || !plan) continue;
        // Map timeline ms back to source ranges through the video track.
        const fps = plan.plan.composition.fps;
        const video = plan.plan.tracks.find((t) => t.type === "video");
        if (video?.type !== "video") continue;
        for (const item of video.items) {
          const a = (item.fromFrame * 1000) / fps;
          const b = ((item.fromFrame + item.durationInFrames) * 1000) / fps;
          if (f.atMs >= a && f.atMs < b) {
            const src = item.sourceStartMs + (f.atMs - a);
            avoidRanges.push({ assetId: item.assetId, startMs: src - 50, endMs: src + 50 });
          }
        }
      }
    }
    const selects = curate({
      transcripts,
      direction: dir.payload,
      avoidRanges,
      energy: (assetId, s, e) => {
        const sig = signals.get(assetId);
        return sig ? rmsEnergy(sig.samples, sig.sampleRate, s, e) : 0.1;
      },
    });
    if (!selects.candidates.some((c) => c.selected)) throw new AgentFailure("NO_SELECTS", "nenhum trecho aproveitável encontrado");
    await ctx.progress(0.9, "registrando selects", "writing_outputs");
    const art = await ctx.tools.createArtifact("selects", selects);
    return { summary: selects.summary, outputRefs: [{ type: "selects", id: art.id, version: art.version }], model: "heuristic-v1" };
  },
};
