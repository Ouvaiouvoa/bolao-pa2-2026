import { createTranscriptionProvider } from "@cmf/media";
import { toSrt, toVtt, type MediaManifest, type TranscriptPayload } from "@cmf/schemas";
import { AgentFailure, type AgentModule } from "../core/types";

/** Groups words into short subtitle cues for the source-level .srt/.vtt exports. */
export function transcriptCues(t: TranscriptPayload) {
  return t.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, lines: [s.text] }));
}

/**
 * Agente Transcrição (6.3): word-level timestamps via the configured provider
 * (default: on-premise Parakeet). Produces transcript.json, .srt, .vtt, language and confidence.
 */
export const transcriptAgent: AgentModule = {
  type: "transcript",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready" && a.metadata.hasAudio);
    return {
      refs: assets.map((a) => ({ kind: "asset", id: a.id, checksum: a.checksum ?? "" })),
      params: { provider: process.env.CMF_ASR_PROVIDER ?? "sherpa-local" },
    };
  },
  async estimateCostCents(ctx) {
    if ((process.env.CMF_ASR_PROVIDER ?? "sherpa-local") !== "openai") return {};
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready");
    const minutes = assets.reduce((n, a) => n + (a.durationMs ?? 0), 0) / 60000;
    return { aiCents: minutes * Number(process.env.CMF_OPENAI_ASR_CENTS_PER_MIN ?? 0.6) };
  },
  async run(ctx) {
    await ctx.progress(0.01, "lendo briefing e manifesto", "reading_inputs");
    const brief = await ctx.tools.readProjectBrief();
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready" && a.metadata.hasAudio);
    if (!assets.length) throw new AgentFailure("NO_AUDIO", "nenhum asset com áudio para transcrever");
    const provider = createTranscriptionProvider({ allowExternal: ctx.policy.allowExternalAi });
    const outputRefs = [];
    let i = 0;
    let lowConfidenceWords = 0;
    for (const asset of assets) {
      const audioKey = asset.metadata.audioKey as string | null;
      if (!audioKey) throw new AgentFailure("NO_AUDIO_DERIVATIVE", `asset ${asset.id} sem áudio extraído`, true);
      const existing = await ctx.tools.readTranscript(asset.id);
      if (existing && existing.provider === provider.id) {
        i++;
        continue; // idempotent: never re-transcribe a ready asset with the same provider
      }
      const wav = await ctx.tools.materialize(audioKey);
      const silences = (asset.metadata.silences as MediaManifest["silences"] | undefined) ?? [];
      await ctx.progress(i / assets.length, `transcrevendo ${asset.originalName} (${provider.id}/${provider.model})`);
      const result = await provider.transcribe({
        assetId: asset.id,
        wavPath: wav,
        durationMs: asset.durationMs ?? 0,
        language: brief.content.language,
        silences,
        onProgress: (f) => void ctx.progress((i + f * 0.9) / assets.length, `transcrevendo ${asset.originalName}`),
      });
      const { usage, ...payload } = result;
      ctx.recordUsage({ model: provider.model, tokensIn: 0, tokensOut: 0, costCents: usage.costCents });
      if (!payload.words.length) throw new AgentFailure("EMPTY_TRANSCRIPT", `nenhuma fala reconhecida em ${asset.originalName}`);
      lowConfidenceWords += payload.words.filter((w) => w.confidence !== null && w.confidence < 0.6).length;
      const saved = await ctx.tools.saveTranscript(payload);
      const srtKey = await ctx.tools.storeProjectFile(`assets/${asset.id}/transcript-v${saved.version}.srt`, { data: toSrt(transcriptCues(payload)) }, "application/x-subrip");
      const vttKey = await ctx.tools.storeProjectFile(`assets/${asset.id}/transcript-v${saved.version}.vtt`, { data: toVtt(transcriptCues(payload)) }, "text/vtt");
      const art = await ctx.tools.createArtifact("transcript", payload, { objectKey: srtKey });
      ctx.log("transcrição concluída", { assetId: asset.id, words: payload.words.length, confidence: payload.confidence, costCents: usage.costCents, vttKey });
      outputRefs.push({ type: "transcript", id: art.id, version: art.version });
      i++;
    }
    return {
      summary: `${assets.length} transcrição(ões) com timestamps por palavra${lowConfidenceWords ? ` · ${lowConfidenceWords} palavra(s) com baixa confiança para revisar` : ""}`,
      outputRefs,
      model: provider.model,
    };
  },
};
