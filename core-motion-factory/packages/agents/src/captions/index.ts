import {
  findTrack,
  frameToMs,
  toSrt,
  toVtt,
  type BrandTokens,
  type CaptionItem,
  type CaptionsArtifact,
  type CreativeDirection,
  type EditPlan,
  type SubtitleCue,
  type TranscriptPayload,
} from "@cmf/schemas";
import { contentStems, emotionScore, hasNumber, NO_LINE_END, stripAccents } from "../core/text";
import { planPartsHash } from "../core/hash";
import { AgentFailure, type AgentModule } from "../core/types";

export interface TimelineWord {
  text: string;
  startFrame: number;
  endFrame: number;
  confidence: number | null;
}

/** Projects transcript words onto the timeline through the video track (jump cuts included). */
export function timelineWords(plan: EditPlan, transcripts: Map<string, TranscriptPayload>): TimelineWord[] {
  const fps = plan.composition.fps;
  const video = findTrack(plan, "video");
  const out: TimelineWord[] = [];
  for (const item of [...(video?.items ?? [])].sort((a, b) => a.fromFrame - b.fromFrame)) {
    const t = transcripts.get(item.assetId);
    if (!t) continue;
    for (const w of t.words) {
      const mid = (w.startMs + w.endMs) / 2;
      if (mid < item.sourceStartMs || mid >= item.sourceEndMs) continue;
      const s = item.fromFrame + Math.max(0, Math.round(((w.startMs - item.sourceStartMs) * fps) / 1000));
      const e = item.fromFrame + Math.min(item.durationInFrames, Math.round(((w.endMs - item.sourceStartMs) * fps) / 1000));
      out.push({ text: w.text, startFrame: s, endFrame: Math.max(s + 1, e), confidence: w.confidence });
    }
  }
  return out;
}

/** Splits words into ≤maxLines lines of ≤maxChars, never ending a line on an article/preposition. */
export function breakLines(words: string[], maxChars: number, maxLines: number): string[] | null {
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    const len = [...cur, w].join(" ").length;
    if (cur.length && len > maxChars) {
      if (lines.length >= maxLines) return null;
      // Move a dangling function word to the next line (unit of meaning).
      const last = cur[cur.length - 1]!;
      if (cur.length > 1 && NO_LINE_END.has(stripAccents(last.toLowerCase()))) {
        cur.pop();
        lines.push([last, w]);
      } else lines.push([w]);
    } else cur.push(w);
  }
  return lines.map((l) => l.join(" "));
}

export interface PageOptions {
  maxChars: number;
  maxLines: number;
  fps: number;
  durationInFrames: number;
  keywordStems: Set<string>;
  maxPageSec?: number;
  pauseBreakSec?: number;
}

/**
 * Caption pages: break at sentence ends, pauses and size limits; highlight at most one
 * meaningful word per page (numbers > keywords > emotional words) and never all pages.
 */
export function buildCaptionPages(words: TimelineWord[], opts: PageOptions): { lines: string[]; words: TimelineWord[]; highlight: number | null }[] {
  const maxPage = Math.round((opts.maxPageSec ?? 2.6) * opts.fps);
  const pauseBreak = Math.round((opts.pauseBreakSec ?? 0.45) * opts.fps);
  const pages: { lines: string[]; words: TimelineWord[]; highlight: number | null }[] = [];
  let cur: TimelineWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const lines = breakLines(cur.map((w) => w.text), opts.maxChars, opts.maxLines) ?? [cur.map((w) => w.text).join(" ")];
    pages.push({ lines, words: cur, highlight: null });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1]!;
      const tooLong = w.endFrame - cur[0]!.startFrame > maxPage;
      const pause = w.startFrame - last.endFrame > pauseBreak;
      const fits = breakLines([...cur, w].map((x) => x.text), opts.maxChars, opts.maxLines) !== null;
      if (tooLong || pause || !fits) flush();
    }
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  // Semantic highlight, limited to ~40% of pages.
  const budget = Math.max(1, Math.floor(pages.length * 0.4));
  let used = 0;
  for (const p of pages) {
    if (used >= budget) break;
    const scored = p.words.map((w, i) => {
      const clean = w.text.replace(/[.,!?…;:]/g, "");
      let s = 0;
      if (/\d/.test(clean) || hasNumber(clean)) s += 3;
      if (contentStems(clean).some((st) => opts.keywordStems.has(st))) s += 2;
      if (emotionScore(clean) > 0) s += 1;
      if (clean.length < 3) s = 0;
      return { i, s };
    });
    const best = scored.sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 2) {
      p.highlight = best.i;
      used++;
    }
  }
  return pages;
}

export function pagesToItems(pages: ReturnType<typeof buildCaptionPages>, opts: PageOptions & { bottomPercent: number; preset: CaptionItem["preset"]; tokens: BrandTokens }): CaptionItem[] {
  const items: CaptionItem[] = [];
  pages.forEach((p, idx) => {
    const next = pages[idx + 1];
    const from = p.words[0]!.startFrame;
    const minEnd = from + Math.round(0.7 * opts.fps);
    const naturalEnd = p.words[p.words.length - 1]!.endFrame + Math.round(0.15 * opts.fps);
    let end = Math.max(minEnd, naturalEnd);
    if (next) end = Math.min(end, next.words[0]!.startFrame);
    end = Math.min(end, opts.durationInFrames);
    if (end <= from) return;
    items.push({
      id: `cap-${String(items.length + 1).padStart(4, "0")}`,
      fromFrame: from,
      durationInFrames: end - from,
      lines: p.lines,
      words: p.words.map((w, i) => ({ text: w.text, startFrame: Math.max(from, w.startFrame), endFrame: Math.min(end, Math.max(w.endFrame, w.startFrame)), highlight: p.highlight === i })),
      preset: opts.preset,
      bottomPercent: opts.bottomPercent,
      color: "#FFFFFF",
      highlightColor: "accent",
      fontFamily: opts.tokens.typography.heading,
    });
  });
  return items;
}

/** Agente Legendas (6.8). */
export const captionsAgent: AgentModule = {
  type: "captions",
  version: "1.1.0",
  cacheable: true,
  async inputs(ctx) {
    const plan = await ctx.tools.readEditPlan();
    const refs: { kind: string; id: string; version?: number; checksum?: string }[] = plan ? [{ kind: "edit_plan.video", id: plan.id, checksum: planPartsHash(plan.plan, ["composition", "video"]) }] : [];
    for (const a of await ctx.tools.listProjectAssets()) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) refs.push({ kind: "transcript", id: t.transcriptId, version: t.version });
    }
    const brand = await ctx.tools.readBrandTokens();
    return { refs: refs.map((r) => (r.kind === "edit_plan.video" ? { kind: r.kind, id: "content", checksum: r.checksum } : r)), params: { captions: brand.tokens.captions, typography: brand.tokens.typography } };
  },
  async run(ctx) {
    await ctx.progress(0.05, "lendo timeline e transcrições", "reading_inputs");
    const current = await ctx.tools.readEditPlan();
    if (!current) throw new AgentFailure("MISSING_EDIT_PLAN", "edit plan ausente");
    const brand = await ctx.tools.readBrandTokens();
    const dir = await ctx.tools.readArtifact<CreativeDirection>("creative_direction");
    const template = await ctx.tools.readTemplate(current.plan.templateId);
    const plan: EditPlan = structuredClone(current.plan);
    const transcripts = new Map<string, TranscriptPayload>();
    for (const a of await ctx.tools.listProjectAssets()) {
      const t = await ctx.tools.readTranscript(a.id);
      if (t) transcripts.set(a.id, t);
    }
    await ctx.progress(0.3, "segmentando por unidade de sentido");
    const fps = plan.composition.fps;
    const tw = timelineWords(plan, transcripts);
    const tk = brand.tokens;
    const layout = template.layouts[dir?.payload.aspect ?? "9:16"] ?? template.layouts["9:16"]!;
    const opts: PageOptions = {
      maxChars: tk.captions.maxCharsPerLine,
      maxLines: tk.captions.maxLines,
      fps,
      durationInFrames: plan.composition.durationInFrames,
      keywordStems: new Set(dir?.payload.keywords ?? []),
    };
    const pages = buildCaptionPages(tw, opts);
    const items = pagesToItems(pages, { ...opts, bottomPercent: Math.max(layout.captionsBottomPercent, tk.captions.safeBottomPercent), preset: template.captionPreset, tokens: tk });
    const track = findTrack(plan, "captions");
    if (!track) throw new AgentFailure("NO_CAPTIONS_TRACK", "edit plan sem trilha de legendas");
    track.items = items;
    await ctx.progress(0.7, "exportando SRT e VTT");
    const cues: SubtitleCue[] = items.map((i) => ({ startMs: frameToMs(i.fromFrame, fps), endMs: frameToMs(i.fromFrame + i.durationInFrames, fps), lines: i.lines }));
    const saved = await ctx.tools.saveEditPlan(plan, `legendas: ${items.length} blocos`);
    const srtKey = await ctx.tools.storeProjectFile(`captions/captions-v${saved.version}.srt`, { data: toSrt(cues) }, "application/x-subrip");
    const vttKey = await ctx.tools.storeProjectFile(`captions/captions-v${saved.version}.vtt`, { data: toVtt(cues) }, "text/vtt");
    const art: CaptionsArtifact = {
      pages: items.length,
      highlightedWords: items.flatMap((i) => i.words.filter((w) => w.highlight).map((w) => w.text)),
      srtKey,
      vttKey,
      maxCharsObserved: Math.max(0, ...items.flatMap((i) => i.lines.map((l) => l.length))),
    };
    const a = await ctx.tools.createArtifact("captions", art, { objectKey: srtKey });
    return {
      summary: `${items.length} blocos de legenda, ${art.highlightedWords.length} destaque(s) semântico(s)`,
      outputRefs: [
        { type: "edit_plan", id: saved.id, version: saved.version },
        { type: "captions", id: a.id, version: a.version },
      ],
      model: "heuristic-v1",
    };
  },
};
