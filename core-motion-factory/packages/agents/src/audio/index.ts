import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "@cmf/media";
import { findTrack, frameToMs, type AudioPlan, type EditPlan, type MediaManifest, type TranscriptPayload } from "@cmf/schemas";
import { timelineWords } from "../captions";
import { planPartsHash } from "../core/hash";
import { AgentFailure, type AgentModule } from "../core/types";

const SPEECH_TARGET_LUFS = -16;
export const GENERATED_MUSIC_ORIGIN = "gerada: cmf-ambient-pad v1 (síntese procedural, sem licença de terceiros)";

/** Merges speech words into ducking ranges (frames), bridging gaps shorter than `bridgeFrames`. */
export function speechRanges(words: { startFrame: number; endFrame: number }[], bridgeFrames: number): [number, number][] {
  const sorted = [...words].sort((a, b) => a.startFrame - b.startFrame);
  const out: [number, number][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.startFrame - last[1] <= bridgeFrames) last[1] = Math.max(last[1], w.endFrame);
    else out.push([w.startFrame, w.endFrame]);
  }
  return out;
}

/** Royalty-free ambient bed synthesized with FFmpeg (chord pad + soft noise), loop-friendly. */
export async function synthesizeAmbientPad(output: string, durationSec: number): Promise<void> {
  const d = Math.max(4, Math.ceil(durationSec + 1));
  // A minor 9 / F maj7 alternating every 4s with slow tremolo — calm and unobtrusive.
  const chord = (f: number[]) => f.map((hz) => `sin(2*PI*${hz}*t)`).join("+");
  const expr = `0.11*(lt(mod(t,8),4)*(${chord([110, 164.81, 220, 261.63, 329.63])})+gte(mod(t,8),4)*(${chord([87.31, 130.81, 174.61, 220, 329.63])}))*(0.75+0.25*sin(2*PI*0.25*t))`;
  await ffmpeg(
    [
      "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=48000:d=${d}`,
      "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.012:d=${d}:r=48000`,
      "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,lowpass=f=2200,afade=t=in:d=1.5,afade=t=out:st=" + (d - 2) + ":d=2,aformat=channel_layouts=stereo",
      "-c:a", "aac", "-b:a", "160k",
      output,
    ],
    { timeoutMs: 120_000 },
  );
}

/** Agente Áudio (6.9): voice normalisation, music bed with ducking, master loudness targets. */
export const audioAgent: AgentModule = {
  type: "audio",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    const brand = await ctx.tools.readBrandTokens();
    const refs: { kind: string; id: string; version?: number; checksum?: string }[] = plan ? [{ kind: "edit_plan.video", id: "content", checksum: planPartsHash(plan.plan, ["composition", "video"]) }] : [];
    for (const a of await ctx.tools.listProjectAssets()) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) refs.push({ kind: "transcript", id: t.transcriptId, version: t.version });
    }
    return { refs, params: { audio: brand.tokens.audio, music: brand.musicAssets.map((m) => m.id) } };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo timeline e medições de loudness", "reading_inputs");
    const current = await ctx.tools.readEditPlan();
    if (!current) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const brand = await ctx.tools.readBrandTokens();
    const plan: EditPlan = structuredClone(current.plan);
    const fps = plan.composition.fps;
    const assets = await ctx.tools.listProjectAssets();
    const notes: string[] = [];
    // 1. Voice gain so speech sits around -16 LUFS before the master loudnorm pass.
    const video = findTrack(plan, "video")!;
    const loudByAsset = new Map(assets.map((a) => [a.id, (a.metadata.loudness as MediaManifest["loudness"] | undefined)?.integratedLufs ?? null]));
    const measured = [...new Set(video.items.map((i) => i.assetId))].map((id) => loudByAsset.get(id)).filter((v): v is number => v !== null && v !== undefined);
    const sourceLufs = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
    const gain = sourceLufs === null ? 1 : Math.min(2, Math.max(0.5, 10 ** ((SPEECH_TARGET_LUFS - sourceLufs) / 20)));
    for (const it of video.items) it.volume = Math.round(gain * 1000) / 1000;
    notes.push(sourceLufs === null ? "loudness da fonte desconhecido; ganho unitário" : `fala medida em ${sourceLufs.toFixed(1)} LUFS → ganho ${gain.toFixed(2)}x`);

    // 2. Music: brand-approved track or a generated royalty-free bed.
    await ctx.progress(0.3, "selecionando trilha");
    let music: { assetId: string; origin: string; durationMs: number | null } | null = brand.musicAssets[0] ? { assetId: brand.musicAssets[0].id, origin: brand.musicAssets[0].origin, durationMs: brand.musicAssets[0].durationMs } : null;
    if (!music) {
      const existing = assets.find((a) => a.type === "music" && a.metadata.origin === GENERATED_MUSIC_ORIGIN && (a.durationMs ?? 0) >= frameToMs(plan.composition.durationInFrames, fps));
      if (existing) music = { assetId: existing.id, origin: GENERATED_MUSIC_ORIGIN, durationMs: existing.durationMs };
      else {
        await ctx.progress(0.4, "sintetizando trilha ambiente (sem direitos de terceiros)");
        const tmp = await mkdtemp(path.join(os.tmpdir(), "cmf-audio-"));
        try {
          const out = path.join(tmp, "ambient-pad.m4a");
          const durSec = frameToMs(plan.composition.durationInFrames, fps) / 1000;
          await synthesizeAmbientPad(out, durSec);
          const id = await ctx.tools.registerGeneratedAsset("music", out, { originalName: "ambient-pad.m4a", durationMs: Math.ceil(durSec + 1) * 1000, origin: GENERATED_MUSIC_ORIGIN });
          music = { assetId: id, origin: GENERATED_MUSIC_ORIGIN, durationMs: Math.ceil(durSec + 1) * 1000 };
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      }
    }
    // 3. Ducking ranges from real speech positions on the timeline.
    await ctx.progress(0.7, "calculando ducking sob a fala");
    const transcripts = new Map<string, TranscriptPayload>();
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.set(a.id, t);
    }
    const ranges = speechRanges(timelineWords(plan, transcripts), Math.round(0.4 * fps));
    const tk = brand.tokens.audio;
    const track = findTrack(plan, "audio");
    if (!track) throw new AgentFailure("NO_AUDIO_TRACK", "edit plan sem trilha de áudio");
    track.items = music
      ? [
          {
            id: "music-bed",
            kind: "music",
            assetId: music.assetId,
            fromFrame: 0,
            durationInFrames: plan.composition.durationInFrames,
            sourceStartMs: 0,
            volume: tk.musicVolume,
            fadeInFrames: Math.round(0.6 * fps),
            fadeOutFrames: Math.round(1.2 * fps),
            loop: true,
            ducking: { enabled: true, duckedVolume: Math.min(tk.duckedMusicVolume, tk.musicVolume), attackFrames: 6, releaseFrames: 12, ranges },
            origin: music.origin,
          },
        ]
      : [];
    const saved = await ctx.tools.saveEditPlan(plan, `áudio: ganho de voz ${gain.toFixed(2)}x, trilha com ducking`);
    const ap: AudioPlan = {
      measuredSourceLufs: sourceLufs,
      voiceGain: gain,
      music: music ? { assetId: music.assetId, origin: music.origin, volume: tk.musicVolume, duckedVolume: tk.duckedMusicVolume } : null,
      speechRanges: ranges.length,
      masterTargetLufs: tk.targetLufs,
      truePeakDb: tk.truePeakDb,
      notes,
    };
    const art = await ctx.tools.createArtifact("audio_plan", ap);
    return {
      summary: `voz ${gain.toFixed(2)}x, trilha ${music ? "com ducking em " + ranges.length + " trechos" : "ausente"}, master alvo ${tk.targetLufs} LUFS`,
      outputRefs: [
        { type: "edit_plan", id: saved.id, version: saved.version },
        { type: "audio_plan", id: art.id, version: art.version },
      ],
      model: "ffmpeg",
    };
  },
};
