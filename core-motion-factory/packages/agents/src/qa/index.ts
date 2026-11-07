import { detectBlack, detectSilences, measureLoudness, probe } from "@cmf/media";
import {
  findTrack,
  frameToMs,
  qaBand,
  type BrandReport,
  type BriefContent,
  type Check,
  type ComplianceReport,
  type EditPlan,
  type EditPlanIssue,
  type QaReport,
  type RenderReport,
  type TranscriptPayload,
} from "@cmf/schemas";
import { timelineWords } from "../captions";
import { contentStems, jaccard } from "../core/text";
import { AgentFailure, type AgentModule, type ApprovalInfo } from "../core/types";
import { onScreenTexts } from "../brand";

export interface TechnicalMeasurements {
  probe: { durationMs: number; width: number | null; height: number | null; fps: number | null; videoCodec: string | null; audioCodec: string | null; hasVideo: boolean; hasAudio: boolean } | null;
  black: { startMs: number; endMs: number }[];
  silences: { startMs: number; endMs: number }[];
  loudness: { integratedLufs: number | null; truePeakDb: number | null };
}

const NUMBER_WORDS: Record<string, string> = { um: "1", uma: "1", primeiro: "1", primeira: "1", dois: "2", duas: "2", segundo: "2", segunda: "2", tres: "3", terceiro: "3", terceira: "3", quatro: "4", quarto: "4", quarta: "4", cinco: "5", quinto: "5", quinta: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10", cem: "100", mil: "1000" };

/** Numbers spoken as words ("segundo erro", "três") map to their digits for coherence checks. */
export function spokenNumberWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => NUMBER_WORDS[w])
    .filter((v): v is string => Boolean(v));
}

const score = (checks: Check[]) => {
  const scored = checks.filter((c) => c.status !== "skip");
  if (!scored.length) return 100;
  const pts = scored.reduce((n, c) => n + (c.status === "pass" ? 1 : c.status === "warn" ? 0.6 : 0), 0);
  return Math.round((pts / scored.length) * 100);
};

/**
 * Pure QA evaluation (section 20). Measurements come from FFmpeg on the real master file.
 * The result never replaces human approval.
 */
export function evaluateQa(input: {
  renderId: string;
  plan: EditPlan;
  brief: BriefContent;
  m: TechnicalMeasurements;
  validationIssues: EditPlanIssue[];
  transcripts: Map<string, TranscriptPayload>;
  brandReport: BrandReport | null;
  compliance: { id: string; payload: ComplianceReport } | null;
  /** Explicit human decision covering the report's high findings (direct or identical findings). */
  complianceCleared: boolean;
  approvals: ApprovalInfo[];
  targetLufs: number;
  truePeakDb: number;
  assetsReady: boolean;
}): QaReport {
  const { plan, m, brief } = input;
  const fps = plan.composition.fps;
  const expectedMs = frameToMs(plan.composition.durationInFrames, fps);
  const blockers: string[] = [];
  const tech: Check[] = [];
  const t = (id: string, label: string, status: Check["status"], detail: string, blocking = false) => {
    tech.push({ id, label, status, detail });
    if (blocking && status === "fail") blockers.push(`${label}: ${detail}`);
  };
  t("playable", "Arquivo reproduzível", m.probe && m.probe.hasVideo ? "pass" : "fail", m.probe ? "ffprobe leu o arquivo" : "ffprobe não conseguiu ler o arquivo", true);
  if (m.probe) {
    const diff = Math.abs(m.probe.durationMs - expectedMs);
    t("duration", "Duração correta", diff <= 1000 / fps + 120 ? "pass" : "fail", `${(m.probe.durationMs / 1000).toFixed(2)}s (esperado ${(expectedMs / 1000).toFixed(2)}s)`, true);
    t("resolution", "Resolução", m.probe.width === plan.composition.width && m.probe.height === plan.composition.height ? "pass" : "fail", `${m.probe.width}×${m.probe.height}`, true);
    t("fps", "FPS", m.probe.fps !== null && Math.abs(m.probe.fps - fps) < 0.05 ? "pass" : "fail", `${m.probe.fps} fps`, true);
    t("codec", "Codec permitido", m.probe.videoCodec === "h264" && (m.probe.audioCodec === "aac" || !m.probe.hasAudio) ? "pass" : "fail", `${m.probe.videoCodec}/${m.probe.audioCodec}`, true);
  }
  const unexpectedBlack = m.black.filter((b) => b.endMs - b.startMs >= 400);
  t("black_frames", "Sem frames pretos inesperados", unexpectedBlack.length ? "fail" : "pass", unexpectedBlack.length ? unexpectedBlack.map((b) => `${(b.startMs / 1000).toFixed(1)}–${(b.endMs / 1000).toFixed(1)}s`).join(", ") : "nenhum");
  const longSilence = m.silences.filter((s) => s.endMs - s.startMs > 2000);
  t("silence", "Sem silêncio indesejado", longSilence.length ? "warn" : "pass", longSilence.length ? `${longSilence.length} silêncio(s) > 2s` : "nenhum silêncio longo");
  const lufs = m.loudness.integratedLufs;
  t("loudness", "Loudness integrado", lufs === null ? "warn" : Math.abs(lufs - input.targetLufs) <= 2 ? "pass" : Math.abs(lufs - input.targetLufs) <= 4 ? "warn" : "fail", lufs === null ? "não medido" : `${lufs} LUFS (alvo ${input.targetLufs})`);
  const tp = m.loudness.truePeakDb;
  t("true_peak", "Pico (true peak)", tp === null ? "warn" : tp <= input.truePeakDb + 0.5 ? "pass" : "fail", tp === null ? "não medido" : `${tp} dBTP (máx ${input.truePeakDb})`);
  const safe = input.validationIssues.filter((i) => i.code === "TEXT_OUTSIDE_SAFE_AREA");
  t("safe_area", "Texto em área segura", safe.length ? "fail" : "pass", safe.length ? `${safe.length} item(ns) fora` : "ok", true);
  t("assets", "Assets acessíveis / sem mídia offline", input.assetsReady ? "pass" : "fail", input.assetsReady ? "todos os assets prontos" : "há asset ausente ou não processado", true);

  // Editorial
  const ed: Check[] = [];
  const motion = findTrack(plan, "motion")?.items ?? [];
  const hook = motion.find((x) => x.kind === "hook_title" && x.fromFrame <= fps * 3);
  ed.push({ id: "hook", label: "Gancho presente", status: hook ? "pass" : "fail", detail: hook && hook.kind === "hook_title" ? `"${hook.text}"` : "sem título de gancho nos 3 primeiros segundos" });
  const words = timelineWords(plan, input.transcripts);
  const spokenStems = new Set(contentStems(words.map((w) => w.text).join(" ")));
  const objStems = [...new Set([...brief.keywords.flatMap((k) => contentStems(k)), ...contentStems(brief.goalStatement)])];
  const objHits = objStems.filter((s) => spokenStems.has(s)).length;
  ed.push({ id: "objective", label: "Objetivo reconhecível", status: objHits >= 2 || objStems.length === 0 ? "pass" : objHits === 1 ? "warn" : "fail", detail: `${objHits} termo(s) do objetivo presentes na fala` });
  const video = findTrack(plan, "video")?.items ?? [];
  const avgClip = video.length ? video.reduce((n, i) => n + i.durationInFrames, 0) / video.length / fps : 0;
  ed.push({ id: "rhythm", label: "Ritmo adequado", status: avgClip >= 1 && avgClip <= 8 ? "pass" : "warn", detail: `${video.length} cortes, média ${avgClip.toFixed(1)}s` });
  const cta = motion.find((x) => x.kind === "cta");
  ed.push({ id: "cta", label: "CTA correto", status: cta && cta.kind === "cta" && cta.headline === brief.cta.text ? "pass" : "fail", detail: cta && cta.kind === "cta" ? `"${cta.headline}"` : "CTA ausente" });
  const captions = findTrack(plan, "captions")?.items ?? [];
  const lowConf = words.filter((w) => w.confidence !== null && w.confidence < 0.5);
  ed.push({ id: "captions", label: "Legendas sem erros críticos", status: !captions.length ? "fail" : lowConf.length ? "warn" : "pass", detail: !captions.length ? "sem legendas" : lowConf.length ? `${lowConf.length} palavra(s) de baixa confiança: ${lowConf.slice(0, 5).map((w) => w.text).join(", ")}` : `${captions.length} blocos` });
  const screenNums = onScreenTexts(plan).filter((x) => x.kind !== "caption" && x.kind !== "footer").flatMap((x) => x.text.match(/\d+/g) ?? []);
  const spokenText = words.map((w) => w.text).join(" ") + " " + brief.goalStatement + " " + brief.keyMessages.join(" ");
  const spokenNums = new Set([...(spokenText.match(/\d+/g) ?? []), ...spokenNumberWords(spokenText)]);
  const strayNums = screenNums.filter((n) => !spokenNums.has(n));
  ed.push({ id: "coherence", label: "Coerência de números e nomes", status: strayNums.length ? "warn" : "pass", detail: strayNums.length ? `números na tela sem respaldo na fala: ${strayNums.join(", ")}` : "ok" });
  const clipTexts = video.map((v) => contentStems(v.label ?? ""));
  let repeats = 0;
  for (let i = 0; i < clipTexts.length; i++) for (let j = i + 1; j < clipTexts.length; j++) if (clipTexts[i]!.length > 3 && jaccard(clipTexts[i]!, clipTexts[j]!) >= 0.8) repeats++;
  ed.push({ id: "repetition", label: "Sem repetições acidentais", status: repeats ? "fail" : "pass", detail: repeats ? `${repeats} trecho(s) repetido(s)` : "ok" });
  const durSec = (m.probe?.durationMs ?? expectedMs) / 1000;
  ed.push({ id: "duration_brief", label: "Duração dentro do briefing", status: durSec >= brief.durationTargetSec.min - 1 && durSec <= brief.durationTargetSec.max + 1 ? "pass" : "warn", detail: `${durSec.toFixed(1)}s (briefing ${brief.durationTargetSec.min}–${brief.durationTargetSec.max}s)` });

  // Brand (from the Brand agent report)
  const br: Check[] = input.brandReport?.checks ?? [{ id: "brand_report", label: "Relatório de marca", status: "fail", detail: "ausente" }];
  for (const b of input.brandReport?.blockers ?? []) blockers.push(`Marca — ${b}`);

  // Compliance
  const co: Check[] = [];
  const rep = input.compliance;
  if (!rep) co.push({ id: "report", label: "Relatório de compliance", status: "fail", detail: "ausente" });
  else {
    const cleared = input.complianceCleared;
    const high = rep.payload.findings.filter((f) => f.severity === "high");
    co.push({ id: "claims", label: "Alegações sinalizadas", status: high.length ? (cleared ? "warn" : "fail") : "pass", detail: high.length ? `${high.length} alerta(s) alto(s) ${cleared ? "liberado(s) por decisão humana registrada" : "SEM decisão humana"}` : `${rep.payload.findings.length} alerta(s) sem severidade alta` });
    if (high.length && !cleared) blockers.push("Compliance: alerta alto sem decisão humana registrada");
    const pd = rep.payload.findings.filter((f) => f.category === "personal_data");
    co.push({ id: "personal_data", label: "Dados pessoais", status: pd.length ? (cleared ? "warn" : "fail") : "pass", detail: pd.length ? `${pd.length} ocorrência(s)` : "nenhum dado pessoal exposto" });
    const origin = rep.payload.findings.filter((f) => f.category === "media_origin");
    co.push({ id: "media_origin", label: "Origem de músicas e imagens", status: origin.length ? "fail" : "pass", detail: origin.length ? "trilha sem origem registrada" : "origens registradas" });
    co.push({ id: "human_approval", label: "Aprovação humana registrada", status: input.approvals.some((a) => a.artifactType === "render_preview" && a.decision === "granted") ? "pass" : "fail", detail: "preview aprovado por humano antes do master" });
  }
  const dims = { technical: { score: score(tech), checks: tech }, editorial: { score: score(ed), checks: ed }, brand: { score: input.brandReport?.score ?? 0, checks: br }, compliance: { score: score(co), checks: co } };
  const total = Math.round(dims.technical.score * 0.35 + dims.editorial.score * 0.25 + dims.brand.score * 0.2 + dims.compliance.score * 0.2);
  const alerts = [...tech, ...ed, ...co].filter((c) => c.status === "warn").map((c) => `${c.label}: ${c.detail}`);
  return {
    renderId: input.renderId,
    score: total,
    band: qaBand(total, blockers.length > 0),
    dimensions: dims,
    blockers,
    alerts,
    note: "Nota alta não substitui aprovação humana do master.",
  };
}

/** Agente QA (6.12) — runs on the real master file. */
export const qaAgent: AgentModule = {
  type: "qa",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const r = await ctx.tools.readArtifact("render_report");
    const approvals = await ctx.tools.listApprovals();
    return { refs: r ? [{ kind: "render_report", id: r.id, version: r.version }] : [], params: { approvals: approvals.length } };
  },
  async run(ctx) {
    await ctx.progress(0.03, "lendo relatório de render e composição", "reading_inputs");
    const rr = await ctx.tools.readArtifact<RenderReport>("render_report");
    if (!rr || rr.payload.kind !== "final") throw new AgentFailure("NO_MASTER", "master final não encontrado para QA");
    const plan = await ctx.tools.readEditPlan();
    if (!plan) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const brief = (await ctx.tools.readProjectBrief()).content;
    const brand = await ctx.tools.readBrandTokens();
    const file = await ctx.tools.materialize(rr.payload.objectKey);
    await ctx.progress(0.2, "inspecionando arquivo (ffprobe)");
    let p: TechnicalMeasurements["probe"] = null;
    try {
      p = await probe(file);
    } catch {
      p = null;
    }
    await ctx.progress(0.4, "procurando frames pretos");
    const black = p ? await detectBlack(file) : [];
    await ctx.progress(0.6, "procurando silêncios e medindo loudness");
    const silences = p?.hasAudio ? await detectSilences(file, { durationMs: p.durationMs, noiseDb: -45, minDurationSec: 1 }) : [];
    const loud = p?.hasAudio ? await measureLoudness(file) : { integratedLufs: null, truePeakDb: null };
    const transcripts = new Map<string, TranscriptPayload>();
    const assets = await ctx.tools.listProjectAssets();
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.set(a.id, t);
    }
    const used = new Set(plan.plan.tracks.flatMap((t) => t.items.map((i) => ("assetId" in i ? i.assetId : null))).filter(Boolean));
    const assetsReady = [...used].every((id) => assets.some((a) => a.id === id && a.status === "ready") || id === brand.logoAssetId || brand.musicAssets.some((m) => m.id === id));
    const brandReport = await ctx.tools.readArtifact<BrandReport>("brand_report");
    const compliance = await ctx.tools.readArtifact<ComplianceReport>("compliance_report");
    const report = evaluateQa({
      renderId: rr.payload.renderId,
      plan: plan.plan,
      brief,
      m: { probe: p, black, silences, loudness: { integratedLufs: loud.integratedLufs, truePeakDb: loud.truePeakDb } },
      validationIssues: await ctx.tools.validateEditPlan(plan.plan),
      transcripts,
      brandReport: brandReport?.payload ?? null,
      compliance: compliance ? { id: compliance.id, payload: compliance.payload } : null,
      complianceCleared: (await ctx.tools.complianceClearance()).cleared,
      approvals: await ctx.tools.listApprovals(),
      targetLufs: brand.tokens.audio.targetLufs,
      truePeakDb: brand.tokens.audio.truePeakDb,
      assetsReady,
    });
    await ctx.progress(0.95, "registrando relatório de QA", "writing_outputs");
    const art = await ctx.tools.createArtifact("qa_report", report);
    return { summary: `QA nota ${report.score} (${report.band})${report.blockers.length ? ` · ${report.blockers.length} bloqueio(s)` : ""}`, outputRefs: [{ type: "qa_report", id: art.id, version: art.version }], model: "ffmpeg+heuristic-v1" };
  },
};
