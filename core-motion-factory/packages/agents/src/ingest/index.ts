import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeWaveformPeaks,
  detectScenes,
  detectSilences,
  estimateFocusByScene,
  extractAudioWav,
  makeMezzanine,
  makeProxy,
  makeThumbnails,
  measureLoudness,
  probe,
  sha256File,
  sniffMime,
} from "@cmf/media";
import type { MediaManifest } from "@cmf/schemas";
import { AgentFailure, type AgentContext, type AgentModule, type AgentOutput } from "../core/types";

const SUPPORTED_FPS = [24, 25, 30, 50, 60];

function normalizeFps(fps: number | null): number {
  if (!fps || !Number.isFinite(fps)) return 30;
  return SUPPORTED_FPS.reduce((best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best), 30);
}

/**
 * Agente Ingest (6.2): validates the real MIME type, checksums, probes, rejects invalid files,
 * keeps the original immutable and produces proxy, mezzanine, audio, waveform, thumbnails,
 * silence/scene/loudness/framing analysis and a media_manifest per asset.
 */
export const ingestAgent: AgentModule = {
  type: "ingest",
  version: "1.2.0",
  cacheable: true,
  async inputs(ctx) {
    const assets = await ctx.tools.listProjectAssets();
    return { refs: assets.filter((a) => a.type !== "music").map((a) => ({ kind: "asset", id: a.id, checksum: a.checksum ?? a.objectKey })) };
  },
  async run(ctx: AgentContext): Promise<AgentOutput> {
    await ctx.progress(0.01, "lendo manifesto de uploads", "reading_inputs");
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.type !== "music");
    const pending = assets.filter((a) => a.status !== "ready" && a.status !== "rejected");
    const outputRefs: AgentOutput["outputRefs"] = [];
    let processed = 0;
    for (const asset of pending) {
      const base = processed / Math.max(1, pending.length);
      const span = 1 / Math.max(1, pending.length);
      const step = (f: number, task: string) => ctx.progress(Math.min(0.99, base + span * f), `${asset.originalName}: ${task}`);
      const tmp = await mkdtemp(path.join(os.tmpdir(), "cmf-ingest-"));
      try {
        await ctx.tools.registerMedia(asset.id, { status: "ingesting" });
        const original = await ctx.tools.readOriginalMedia(asset.id);
        await step(0.02, "verificando tipo real do arquivo");
        const sniff = await sniffMime(original);
        if (sniff.kind !== "video" && sniff.kind !== "audio") {
          await ctx.tools.registerMedia(asset.id, { status: "rejected", mimeType: sniff.mime, metadata: { rejection: `tipo não suportado: ${sniff.mime}` } });
          ctx.log("asset rejeitado", { assetId: asset.id, mime: sniff.mime });
          processed++;
          continue;
        }
        await step(0.05, "calculando checksum");
        const checksum = await sha256File(original);
        if (asset.checksum && asset.checksum !== checksum) throw new AgentFailure("CHECKSUM_MISMATCH", `checksum do original diverge do upload (${asset.id})`);
        await step(0.08, "extraindo metadados (ffprobe)");
        const info = await probe(original);
        if ((!info.hasVideo && !info.hasAudio) || info.durationMs < 500) {
          await ctx.tools.registerMedia(asset.id, { status: "rejected", mimeType: sniff.mime, metadata: { rejection: "arquivo sem trilhas de mídia válidas" } });
          processed++;
          continue;
        }
        const fps = normalizeFps(info.fps);
        const alerts: MediaManifest["alerts"] = [];
        if (info.fps && Math.abs(info.fps - fps) > 0.05) alerts.push({ code: "FPS_NORMALIZED", severity: "info", message: `fps ${info.fps} normalizado para ${fps}` });
        const keys: Record<string, string> = {};
        let proxy: MediaManifest["proxy"] = null;
        let thumbnails: MediaManifest["thumbnails"] = [];
        let scenes: MediaManifest["scenes"] = [];
        let framing: MediaManifest["framing"] = { focusX: 0.5, focusY: 0.5, method: "none", confidence: 0, segments: [] };
        if (info.hasVideo && info.width && info.height) {
          await step(0.12, "gerando proxy de edição");
          const proxyPath = path.join(tmp, "proxy.mp4");
          const p = await makeProxy(original, proxyPath, { sourceWidth: info.width, sourceHeight: info.height, hasAudio: info.hasAudio, fps, durationMs: info.durationMs, onProgress: (f) => void step(0.12 + f * 0.2, "gerando proxy de edição"), timeoutMs: 60 * 60_000 });
          keys.proxy = await ctx.tools.storeProjectFile(`assets/${asset.id}/proxy.mp4`, { path: proxyPath }, "video/mp4");
          proxy = { objectKey: keys.proxy, width: p.width, height: p.height, fps: p.fps };
          await step(0.33, "gerando mezanino para o master");
          const mezPath = path.join(tmp, "mezzanine.mp4");
          await makeMezzanine(original, mezPath, { sourceWidth: info.width, sourceHeight: info.height, hasAudio: info.hasAudio, fps, durationMs: info.durationMs, onProgress: (f) => void step(0.33 + f * 0.25, "gerando mezanino para o master"), timeoutMs: 2 * 60 * 60_000 });
          keys.mezzanine = await ctx.tools.storeProjectFile(`assets/${asset.id}/mezzanine.mp4`, { path: mezPath }, "video/mp4");
          await step(0.6, "gerando thumbnails");
          const thumbPaths = Array.from({ length: 6 }, (_, i) => path.join(tmp, `thumb-${i}.jpg`));
          const times = await makeThumbnails(proxyPath, thumbPaths, info.durationMs);
          thumbnails = [];
          for (let i = 0; i < thumbPaths.length; i++) {
            const key = await ctx.tools.storeProjectFile(`assets/${asset.id}/thumb-${String(i).padStart(3, "0")}.jpg`, { path: thumbPaths[i]! }, "image/jpeg");
            thumbnails.push({ objectKey: key, atMs: times[i]! });
          }
          await step(0.66, "detectando cortes de cena");
          scenes = await detectScenes(proxyPath);
          await step(0.72, "estimando enquadramento do sujeito");
          const segments = await estimateFocusByScene(proxyPath, p.width, p.height, info.durationMs, scenes);
          const total = segments.reduce((n, s) => n + (s.endMs - s.startMs), 0) || 1;
          framing = {
            focusX: Math.round((segments.reduce((n, s) => n + s.focusX * (s.endMs - s.startMs), 0) / total) * 1000) / 1000,
            focusY: Math.round((segments.reduce((n, s) => n + s.focusY * (s.endMs - s.startMs), 0) / total) * 1000) / 1000,
            method: "motion-energy-by-scene",
            confidence: Math.round((segments.reduce((n, s) => n + s.confidence * (s.endMs - s.startMs), 0) / total) * 100) / 100,
            segments,
          };
          if (framing.confidence < 0.35) alerts.push({ code: "FRAMING_UNCERTAIN", severity: "low", message: "enquadramento automático com baixa confiança; revise o reframing" });
        }
        let audioWav: MediaManifest["audioWav"] = null;
        let waveform: MediaManifest["waveform"] = null;
        let silences: MediaManifest["silences"] = [];
        let loudness: MediaManifest["loudness"] = { integratedLufs: null, truePeakDb: null, lra: null };
        if (info.hasAudio) {
          await step(0.8, "extraindo áudio para transcrição");
          const wavPath = path.join(tmp, "audio-16k.wav");
          await extractAudioWav(original, wavPath, 16000, { timeoutMs: 60 * 60_000 });
          keys.audio = await ctx.tools.storeProjectFile(`assets/${asset.id}/audio-16k.wav`, { path: wavPath }, "audio/wav");
          audioWav = { objectKey: keys.audio, sampleRate: 16000 };
          await step(0.85, "gerando waveform");
          const peaks = await computeWaveformPeaks(wavPath, 50);
          const wfPath = path.join(tmp, "waveform.json");
          await writeFile(wfPath, JSON.stringify({ peaksPerSecond: 50, peaks: peaks.peaks }));
          keys.waveform = await ctx.tools.storeProjectFile(`assets/${asset.id}/waveform.json`, { path: wfPath }, "application/json");
          waveform = { objectKey: keys.waveform, peaksPerSecond: 50, count: peaks.peaks.length };
          await step(0.9, "detectando silêncios");
          silences = await detectSilences(wavPath, { durationMs: info.durationMs, noiseDb: -35, minDurationSec: 0.3 });
          await step(0.94, "medindo loudness (EBU R128)");
          loudness = await measureLoudness(original);
          if (loudness.truePeakDb !== null && loudness.truePeakDb > -0.5) alerts.push({ code: "AUDIO_CLIPPING", severity: "medium", message: `áudio estourado (true peak ${loudness.truePeakDb} dBFS)` });
          if (loudness.integratedLufs !== null && loudness.integratedLufs < -30) alerts.push({ code: "AUDIO_LOW", severity: "medium", message: `áudio muito baixo (${loudness.integratedLufs} LUFS)` });
        } else {
          alerts.push({ code: "NO_AUDIO", severity: "medium", message: "asset sem trilha de áudio — não haverá transcrição" });
        }
        const orientation: MediaManifest["orientation"] = !info.hasVideo
          ? "audio_only"
          : info.width! > info.height! * 1.05
            ? "landscape"
            : info.height! > info.width! * 1.05
              ? "portrait"
              : "square";
        const manifest: MediaManifest = {
          assetId: asset.id,
          original: { objectKey: asset.objectKey, checksum, mime: sniff.mime, sizeBytes: asset.sizeBytes ?? 0 },
          probe: {
            durationMs: info.durationMs,
            width: info.width,
            height: info.height,
            fps,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            hasVideo: info.hasVideo,
            hasAudio: info.hasAudio,
            rotation: info.rotation,
            sampleRate: info.sampleRate,
            channels: info.channels,
            bitRate: info.bitRate,
            formatName: info.formatName,
          },
          proxy,
          audioWav,
          waveform,
          thumbnails,
          orientation,
          framing,
          silences,
          scenes,
          loudness,
          alerts,
        };
        await step(0.97, "registrando manifesto");
        const art = await ctx.tools.createArtifact("media_manifest", manifest);
        await ctx.tools.registerMedia(asset.id, {
          status: "ready",
          durationMs: info.durationMs,
          width: info.width,
          height: info.height,
          fps,
          proxyKey: keys.proxy ?? null,
          checksum,
          mimeType: sniff.mime,
          codec: info.videoCodec ?? info.audioCodec,
          metadata: {
            mezzanineKey: keys.mezzanine ?? null,
            audioKey: keys.audio ?? null,
            waveformKey: keys.waveform ?? null,
            thumbnails,
            hasAudio: info.hasAudio,
            hasVideo: info.hasVideo,
            framing,
            loudness,
            silences,
            scenes,
            manifestArtifactId: art.id,
          },
        });
        outputRefs.push({ type: "media_manifest", id: art.id, version: art.version });
        processed++;
      } catch (err) {
        await ctx.tools.registerMedia(asset.id, { status: "failed", metadata: { error: (err as Error).message } }).catch(() => undefined);
        throw err;
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
    const ready = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready" && a.type !== "music");
    if (!ready.length) throw new AgentFailure("NO_VALID_MEDIA", "nenhum material válido após a ingestão", false);
    return { summary: `${processed} asset(s) processado(s); ${ready.length} pronto(s) para edição`, outputRefs, model: "ffmpeg" };
  },
};
