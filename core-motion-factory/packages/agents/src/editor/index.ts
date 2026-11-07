import {
  EDIT_PLAN_SCHEMA_VERSION,
  findTrack,
  frameToMs,
  type CreativeDirection,
  type EditPlan,
  type MediaManifest,
  type RevisionPlan,
  type Script,
  type ScriptVariant,
  type TranscriptPayload,
  type TranscriptWord,
  type VideoItem,
} from "@cmf/schemas";
import type { TemplateDefinition } from "@cmf/templates";
import { AgentFailure, type AgentModule, type ReviewCommentInfo } from "../core/types";

export interface AssetMediaInfo {
  durationMs: number;
  framing: MediaManifest["framing"] | null;
}

function focusAt(info: AssetMediaInfo | undefined, ms: number): { x: number; y: number } {
  if (!info?.framing) return { x: 0.5, y: 0.5 };
  const seg = info.framing.segments.find((s) => ms >= s.startMs && ms < s.endMs);
  return { x: seg?.focusX ?? info.framing.focusX, y: seg?.focusY ?? info.framing.focusY };
}

/** Splits [start, start+frames) at framing-segment boundaries (frame-exact, pieces ≥ 0.4s). */
export function splitAtScenes(startMs: number, frames: number, fps: number, info: AssetMediaInfo | undefined): { startMs: number; frames: number }[] {
  const endMs = startMs + frameToMs(frames, fps);
  const cuts = (info?.framing?.segments ?? []).map((s) => s.startMs).filter((t) => t > startMs + 400 && t < endMs - 400);
  if (!cuts.length) return [{ startMs, frames }];
  const out: { startMs: number; frames: number }[] = [];
  let curStart = startMs;
  let used = 0;
  for (const c of cuts) {
    const f = Math.round(((c - curStart) * fps) / 1000);
    if (f <= 0) continue;
    out.push({ startMs: curStart, frames: f });
    used += f;
    curStart = curStart + frameToMs(f, fps);
  }
  out.push({ startMs: curStart, frames: frames - used });
  return out.filter((p) => p.frames > 0);
}

/**
 * Converts script beats into frame-accurate video items with intentional jump cuts:
 * pauses longer than the template threshold are removed, every Nth cut gets a punch-in,
 * and reframing follows the subject focus of the scene each clip comes from.
 */
export function assembleVideoItems(
  variant: ScriptVariant,
  transcripts: Map<string, TranscriptPayload>,
  media: Map<string, AssetMediaInfo>,
  fps: number,
  pacing: TemplateDefinition["pacing"],
): VideoItem[] {
  const items: VideoItem[] = [];
  let cursor = 0;
  let cutIndex = 0;
  for (const beat of variant.beats) {
    if (!beat.assetId || beat.startMs === null || beat.endMs === null) continue;
    const t = transcripts.get(beat.assetId);
    const info = media.get(beat.assetId);
    const assetDur = info?.durationMs ?? beat.endMs + 1000;
    const words = (t?.words ?? []).filter((w) => w.startMs >= beat.startMs! - 20 && w.endMs <= beat.endMs! + 20);
    const runs: TranscriptWord[][] = [];
    for (const w of words) {
      const run = runs[runs.length - 1];
      if (run && w.startMs - run[run.length - 1]!.endMs <= pacing.removePausesOverMs) run.push(w);
      else runs.push([w]);
    }
    if (!runs.length) runs.push([{ text: beat.text, startMs: beat.startMs, endMs: beat.endMs, confidence: null }]);
    let prevSrcEnd = 0;
    runs.forEach((run, ri) => {
      // Snap cut points to the source frame grid so trims are frame-exact.
      let start = (Math.ceil((Math.max(0, run[0]!.startMs - pacing.cutPaddingMs, prevSrcEnd) * fps) / 1000 - 1e-6) * 1000) / fps;
      const end = Math.min(assetDur, run[run.length - 1]!.endMs + pacing.cutPaddingMs);
      const frames = Math.max(1, Math.round(((end - start) * fps) / 1000));
      let srcEnd = start + frameToMs(frames, fps);
      if (srcEnd > assetDur) {
        start = Math.max(0, assetDur - frameToMs(frames, fps));
        srcEnd = start + frameToMs(frames, fps);
      }
      const n = pacing.punchInEveryNthCut;
      const punch = n > 0 && cutIndex % n === n - 1;
      // A clip that crosses a camera/scene change is split so each part keeps its own reframing.
      const pieces = splitAtScenes(start, frames, fps, info);
      pieces.forEach((pc, pi) => {
        items.push({
          id: `clip-${String(items.length + 1).padStart(3, "0")}`,
          assetId: beat.assetId!,
          fromFrame: cursor,
          durationInFrames: pc.frames,
          sourceStartMs: Math.round(pc.startMs * 1000) / 1000,
          sourceEndMs: Math.round((pc.startMs + frameToMs(pc.frames, fps)) * 1000) / 1000,
          fit: "cover",
          focus: focusAt(info, pc.startMs + frameToMs(pc.frames, fps) / 2),
          transform: { x: 0, y: 0, scale: punch ? pacing.punchInScale : 1, rotation: 0 },
          volume: 1,
          label: run.map((w) => w.text).join(" ").slice(0, 110),
          beatId: ri === 0 && pi === 0 ? beat.id : `${beat.id}.${ri}${pi ? `-${pi}` : ""}`,
        });
        cursor += pc.frames;
      });
      prevSrcEnd = srcEnd;
      cutIndex++;
    });
  }
  return items;
}

export function emptyPlan(projectId: string, brandId: string, templateId: string, comp: { width: number; height: number; fps: number }, durationInFrames: number, background: string): EditPlan {
  return {
    schemaVersion: EDIT_PLAN_SCHEMA_VERSION,
    projectId,
    composition: { width: comp.width, height: comp.height, fps: comp.fps as EditPlan["composition"]["fps"], durationInFrames: Math.max(1, durationInFrames), backgroundColor: background },
    tracks: [
      { id: "video-main", type: "video", locked: false, muted: false, items: [] },
      { id: "captions-main", type: "captions", locked: false, muted: false, items: [] },
      { id: "motion-main", type: "motion", locked: false, muted: false, items: [] },
      { id: "audio-main", type: "audio", locked: false, muted: false, items: [] },
    ],
    brandId,
    templateId,
    metadata: { createdBy: "agent-editor", createdAt: new Date().toISOString(), basedOnVersion: null, notes: "" },
  };
}

/** Removes [startFrame, endFrame) from the video track and ripples everything after it. */
export function applyCut(items: VideoItem[], startFrame: number, endFrame: number, fps: number): VideoItem[] {
  const len = endFrame - startFrame;
  if (len <= 0) return items;
  const out: VideoItem[] = [];
  for (const it of items) {
    const a = it.fromFrame;
    const b = it.fromFrame + it.durationInFrames;
    if (b <= startFrame) out.push(it);
    else if (a >= endFrame) out.push({ ...it, fromFrame: a - len });
    else {
      if (startFrame > a) {
        const d = startFrame - a;
        out.push({ ...it, durationInFrames: d, sourceEndMs: it.sourceStartMs + frameToMs(d, fps) });
      }
      if (b > endFrame) {
        const skip = endFrame - a;
        const d = b - endFrame;
        out.push({
          ...it,
          id: `${it.id}-r`,
          fromFrame: startFrame,
          durationInFrames: d,
          sourceStartMs: it.sourceStartMs + frameToMs(skip, fps),
          sourceEndMs: it.sourceStartMs + frameToMs(skip + d, fps),
        });
      }
    }
  }
  return out.sort((x, y) => x.fromFrame - y.fromFrame);
}

/** Maps a timeline position to the transcript word under it. */
export function wordAtTimeline(plan: EditPlan, transcripts: Map<string, TranscriptPayload>, timelineMs: number): { assetId: string; wordIndex: number } | null {
  const fps = plan.composition.fps;
  const frame = Math.floor((timelineMs * fps) / 1000);
  const video = findTrack(plan, "video");
  const item = video?.items.find((i) => frame >= i.fromFrame && frame < i.fromFrame + i.durationInFrames);
  if (!item) return null;
  const srcMs = item.sourceStartMs + frameToMs(frame - item.fromFrame, fps);
  const t = transcripts.get(item.assetId);
  if (!t) return null;
  let best = -1;
  let bestDist = Infinity;
  t.words.forEach((w, i) => {
    const d = srcMs < w.startMs ? w.startMs - srcMs : srcMs > w.endMs ? srcMs - w.endMs : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best >= 0 && bestDist <= 400 ? { assetId: item.assetId, wordIndex: best } : null;
}

const STRUCTURED = new Set(["cut", "text_fix", "remove_motion"]);

/** Agente Editor (6.6): script + selects → edit_plan.json; applies structured review comments on revisions. */
export const editorAgent: AgentModule = {
  type: "editor",
  version: "1.2.0",
  cacheable: true,
  async inputs(ctx) {
    const script = await ctx.tools.readArtifact("script");
    const approvals = (await ctx.tools.listApprovals()).filter((a) => a.artifactType === "script" && a.decision === "granted");
    const comments = (await ctx.tools.listReviewComments()).filter((c) => c.status === "open" && STRUCTURED.has(c.kind));
    const refs: { kind: string; id: string; version?: number }[] = script ? [{ kind: "script", id: script.id, version: script.version }] : [];
    for (const a of await ctx.tools.listProjectAssets()) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) refs.push({ kind: "transcript", id: t.transcriptId, version: t.version });
    }
    return { refs, params: { variant: approvals[0]?.reason ?? "", comments: comments.map((c) => c.id).sort() } };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo roteiro aprovado e direção", "reading_inputs");
    const brand = await ctx.tools.readBrandTokens();
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    const script = await ctx.tools.readArtifact<Script>("script");
    if (!dir || !script) throw new AgentFailure("MISSING_INPUTS", "direção criativa ou roteiro ausentes");
    const template = await ctx.tools.readTemplate(dir.payload.templateId);
    const assets = (await ctx.tools.listProjectAssets()).filter((a) => a.status === "ready" && a.type === "video");
    const transcripts = new Map<string, TranscriptPayload>();
    const media = new Map<string, AssetMediaInfo>();
    for (const a of assets) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.set(a.id, t);
      media.set(a.id, { durationMs: a.durationMs ?? 0, framing: (a.metadata.framing as MediaManifest["framing"]) ?? null });
    }
    const fps = dir.payload.composition.fps;
    const comments = (await ctx.tools.listReviewComments()).filter((c) => c.status === "open" && STRUCTURED.has(c.kind));
    const previous = await ctx.tools.readEditPlan();

    if (comments.length && previous) {
      return reviseFromComments(ctx, previous, comments, transcripts, fps);
    }

    const granted = (await ctx.tools.listApprovals()).find((a) => a.artifactType === "script" && a.decision === "granted" && a.artifactId === script.id);
    const variantId: "A" | "B" = granted && /variante B/.test(granted.reason) ? "B" : script.payload.chosenVariant;
    const variant = script.payload.variants.find((v) => v.id === variantId) ?? script.payload.variants[0]!;
    await ctx.progress(0.3, `montando timeline da variante ${variant.id} com jump cuts`);
    const items = assembleVideoItems(variant, transcripts, media, fps, template.pacing);
    if (!items.length) throw new AgentFailure("EMPTY_TIMELINE", "nenhum clipe gerado a partir do roteiro");
    const videoFrames = items.reduce((n, i) => Math.max(n, i.fromFrame + i.durationInFrames), 0);
    const spokenCta = variant.beats.some((b) => b.kind === "cta" && b.assetId);
    const layout = template.layouts[dir.payload.aspect] ?? template.layouts["9:16"]!;
    const ctaFrames = spokenCta ? 0 : Math.round(layout.cta.durationSec * fps);
    const plan = emptyPlan(ctx.projectId, brand.brandId, template.id, dir.payload.composition, videoFrames + ctaFrames, brand.tokens.colors.primary);
    const video = findTrack(plan, "video")!;
    video.items = items;
    plan.metadata.notes = `variante ${variant.id}; ${items.length} clipes; ${spokenCta ? "CTA falado" : "CTA em cartela"}`;
    plan.metadata.basedOnVersion = previous?.version ?? null;
    await ctx.progress(0.8, "validando e salvando edit_plan.json", "writing_outputs");
    const saved = await ctx.tools.saveEditPlan(plan, `montagem inicial (variante ${variant.id})`);
    return {
      summary: `timeline com ${items.length} clipes, ${(videoFrames / fps).toFixed(1)}s de vídeo${ctaFrames ? ` + ${(ctaFrames / fps).toFixed(1)}s de cartela` : ""}`,
      outputRefs: [{ type: "edit_plan", id: saved.id, version: saved.version }],
      model: "heuristic-v1",
    };
  },
};

async function reviseFromComments(
  ctx: Parameters<AgentModule["run"]>[0],
  latest: { id: string; version: number; plan: EditPlan },
  comments: ReviewCommentInfo[],
  transcripts: Map<string, TranscriptPayload>,
  fps: number,
) {
  await ctx.progress(0.2, `aplicando ${comments.length} comentário(s) estruturado(s) da revisão`);
  const applied: RevisionPlan["applied"] = [];
  const skipped: RevisionPlan["skipped"] = [];
  const plan: EditPlan = structuredClone(latest.plan);
  // Comments refer to the plan version that was rendered for review.
  const basePlans = new Map<string, EditPlan>();
  const planFor = async (c: ReviewCommentInfo) => {
    if (!c.renderEditPlanId || c.renderEditPlanId === latest.id) return latest.plan;
    if (!basePlans.has(c.renderEditPlanId)) basePlans.set(c.renderEditPlanId, (await ctx.tools.readEditPlan(c.renderEditPlanId))?.plan ?? latest.plan);
    return basePlans.get(c.renderEditPlanId)!;
  };
  // 1. Text fixes → transcript correction (captions are rebuilt from the transcript).
  const edited = new Map<string, TranscriptPayload>();
  for (const c of comments.filter((x) => x.kind === "text_fix")) {
    const base = await planFor(c);
    const hit = wordAtTimeline(base, transcripts, c.timecodeMs);
    if (!hit || !c.replacement?.trim()) {
      skipped.push({ commentId: c.id, reason: hit ? "comentário sem texto de substituição" : "nenhuma palavra encontrada no timecode" });
      continue;
    }
    const t = edited.get(hit.assetId) ?? structuredClone(transcripts.get(hit.assetId)!);
    const before = t.words[hit.wordIndex]!.text;
    t.words[hit.wordIndex] = { ...t.words[hit.wordIndex]!, text: c.replacement.trim(), confidence: 1 };
    for (const s of t.segments) if (hit.wordIndex >= s.wordStart && hit.wordIndex <= s.wordEnd) s.text = t.words.slice(s.wordStart, s.wordEnd + 1).map((w) => w.text).join(" ");
    t.text = t.words.map((w) => w.text).join(" ");
    edited.set(hit.assetId, t);
    applied.push({ commentId: c.id, action: "text_fix", detail: `"${before}" → "${c.replacement.trim()}"` });
  }
  for (const t of edited.values()) {
    const { assetId, language, provider, model, durationMs, text, confidence, segments, words } = t;
    await ctx.tools.saveTranscript({ assetId, language, provider, model, durationMs, text, confidence, segments, words }, "review-comment");
  }
  // 2. Motion removals → recorded so the Motion agent will not recreate the element.
  for (const c of comments.filter((x) => x.kind === "remove_motion")) {
    const base = await planFor(c);
    const frame = Math.floor((c.timecodeMs * fps) / 1000);
    const motion = findTrack(base, "motion");
    const hits = (motion?.items ?? []).filter((m) => frame >= m.fromFrame && frame < m.fromFrame + m.durationInFrames && m.kind !== "footer" && m.kind !== "logo" && m.kind !== "progress_bar");
    if (!hits.length) skipped.push({ commentId: c.id, reason: "nenhum elemento de motion no timecode" });
    for (const m of hits) {
      const text = "text" in m ? m.text : "headline" in m ? m.headline : "name" in m ? m.name : "";
      applied.push({ commentId: c.id, action: "remove_motion", detail: `${m.kind}|${text}` });
    }
  }
  // 3. Cuts → ripple delete on the video track (latest plan), processed back to front.
  const video = findTrack(plan, "video")!;
  const cuts = comments
    .filter((x) => x.kind === "cut")
    .map((c) => ({ c, s: Math.floor((c.timecodeMs * fps) / 1000), e: Math.ceil(((c.endTimecodeMs ?? c.timecodeMs + 1000) * fps) / 1000) }))
    .sort((a, b) => b.s - a.s);
  let removed = 0;
  for (const { c, s, e } of cuts) {
    if (e <= s) {
      skipped.push({ commentId: c.id, reason: "intervalo de corte inválido" });
      continue;
    }
    video.items = applyCut(video.items, s, Math.min(e, plan.composition.durationInFrames), fps);
    removed += Math.min(e, plan.composition.durationInFrames) - s;
    applied.push({ commentId: c.id, action: "cut", detail: `frames ${s}–${e} removidos (${((e - s) / fps).toFixed(2)}s)` });
  }
  plan.composition.durationInFrames = Math.max(1, plan.composition.durationInFrames - removed);
  // Cuts shift the timeline: dependent tracks are rebuilt by Captions/Motion/Audio (their inputs change).
  // Without cuts the tracks stay; agents whose inputs changed (transcript, suppressions) rewrite theirs.
  if (removed > 0) for (const t of plan.tracks) if (t.type !== "video") t.items = [];
  plan.metadata = { ...plan.metadata, createdBy: "agent-editor", createdAt: new Date().toISOString(), basedOnVersion: latest.version, notes: `revisão: ${applied.length} ajuste(s) aplicados` };
  await ctx.progress(0.75, "validando e salvando nova versão", "writing_outputs");
  const saved = await ctx.tools.saveEditPlan(plan, `revisão automática (${applied.length} ajuste(s))`);
  const prevRev = await ctx.tools.readArtifact<RevisionPlan>("revision_plan");
  const suppressedMotion = [...new Set([...(prevRev?.payload.suppressedMotion ?? []), ...applied.filter((a) => a.action === "remove_motion").map((a) => a.detail)])];
  const rev: RevisionPlan = { basedOnEditPlanVersion: latest.version, applied, skipped, suppressedMotion };
  const art = await ctx.tools.createArtifact("revision_plan", rev);
  await ctx.tools.resolveReviewComments(
    comments.filter((c) => applied.some((a) => a.commentId === c.id)).map((c) => c.id),
    saved.id,
  );
  return {
    summary: `revisão: ${applied.length} ajuste(s) aplicados, ${skipped.length} ignorado(s)`,
    outputRefs: [
      { type: "edit_plan", id: saved.id, version: saved.version },
      { type: "revision_plan", id: art.id, version: art.version },
    ],
    model: "heuristic-v1",
  };
}
