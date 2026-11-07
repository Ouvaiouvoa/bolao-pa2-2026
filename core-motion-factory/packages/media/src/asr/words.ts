import type { TranscriptSegment, TranscriptWord } from "@cmf/schemas";

const PUNCT_ONLY = /^[.,!?;:…"'»«)(\-–—]+$/u;

export interface TokenStream {
  tokens: string[];
  /** Token start time in seconds (relative to chunk). */
  timestamps: number[];
  /** Token durations in seconds (optional). */
  durations?: number[];
  /** Token log probabilities (optional). */
  logProbs?: number[];
}

/** Some models omit the leading space before digits ("que3") or after sentence punctuation ("garantido.100%"). */
function impliedBoundary(prev: string, piece: string): boolean {
  if (PUNCT_ONLY.test(piece)) return false;
  const a = prev.slice(-1);
  const b = piece[0] ?? "";
  if (/\p{L}/u.test(a) && /\d/.test(b)) return true;
  if (/[.!?;:,]/.test(a) && /[\p{L}\d]/u.test(b)) return !(/\d[.,]$/.test(prev) && /\d/.test(b));
  return false;
}

/**
 * SentencePiece/BPE tokens → words. A token starting with a space (or "▁") opens a new word;
 * punctuation-only tokens attach to the previous word.
 */
export function tokensToWords(stream: TokenStream, offsetMs: number, chunkEndMs: number): TranscriptWord[] {
  const words: { text: string; start: number; end: number; lps: number[] }[] = [];
  const n = stream.tokens.length;
  for (let i = 0; i < n; i++) {
    const raw = stream.tokens[i] ?? "";
    const startsWord = /^[\s▁]/.test(raw) || words.length === 0;
    const piece = raw.replace(/^[\s▁]+/, "");
    if (!piece) continue;
    const start = offsetMs + (stream.timestamps[i] ?? 0) * 1000;
    const dur = stream.durations?.[i];
    const nextStart = i + 1 < n ? offsetMs + (stream.timestamps[i + 1] ?? 0) * 1000 : chunkEndMs;
    const end = dur && dur > 0 ? Math.min(start + dur * 1000, Math.max(nextStart, start + 40)) : nextStart;
    const lp = stream.logProbs?.[i];
    const last = words[words.length - 1];
    if (last && (!startsWord || PUNCT_ONLY.test(piece)) && !impliedBoundary(last.text, piece)) {
      last.text += piece;
      last.end = Math.max(last.end, end);
      if (lp !== undefined) last.lps.push(lp);
    } else {
      words.push({ text: piece, start, end, lps: lp !== undefined ? [lp] : [] });
    }
  }
  return words.map((w) => ({
    text: w.text,
    startMs: Math.round(w.start),
    endMs: Math.round(Math.max(w.end, w.start + 40)),
    confidence: w.lps.length ? Math.round(Math.exp(w.lps.reduce((a, b) => a + b, 0) / w.lps.length) * 1000) / 1000 : null,
  }));
}

/** Groups words into sentence-like segments (punctuation, long pauses or max length). */
export function buildSegments(words: TranscriptWord[], opts: { pauseMs?: number; maxMs?: number } = {}): TranscriptSegment[] {
  const pauseMs = opts.pauseMs ?? 700;
  const maxMs = opts.maxMs ?? 15_000;
  const segments: TranscriptSegment[] = [];
  let start = 0;
  const flush = (endIdx: number) => {
    if (endIdx < start) return;
    const slice = words.slice(start, endIdx + 1);
    const confs = slice.map((w) => w.confidence).filter((c): c is number => c !== null);
    segments.push({
      id: `seg_${String(segments.length + 1).padStart(3, "0")}`,
      startMs: slice[0]!.startMs,
      endMs: slice[slice.length - 1]!.endMs,
      text: slice.map((w) => w.text).join(" "),
      confidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000 : null,
      wordStart: start,
      wordEnd: endIdx,
    });
    start = endIdx + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    const sentenceEnd = /[.!?…]["»)]?$/.test(w.text);
    const longPause = next ? next.startMs - w.endMs > pauseMs : false;
    const tooLong = w.endMs - words[start]!.startMs > maxMs;
    if (sentenceEnd || longPause || tooLong || !next) flush(i);
  }
  return segments;
}

/** Chooses chunk boundaries at silence midpoints so no chunk exceeds maxChunkMs. */
export function planChunks(durationMs: number, silences: { startMs: number; endMs: number }[], maxChunkMs = 25_000): { startMs: number; endMs: number }[] {
  const chunks: { startMs: number; endMs: number }[] = [];
  let cursor = 0;
  const mids = silences.map((s) => (s.startMs + s.endMs) / 2).sort((a, b) => a - b);
  while (durationMs - cursor > maxChunkMs) {
    const limit = cursor + maxChunkMs;
    const candidates = mids.filter((m) => m > cursor + 2000 && m <= limit);
    const cut = candidates.length ? candidates[candidates.length - 1]! : limit;
    chunks.push({ startMs: Math.round(cursor), endMs: Math.round(cut) });
    cursor = cut;
  }
  chunks.push({ startMs: Math.round(cursor), endMs: Math.round(durationMs) });
  return chunks.filter((c) => c.endMs - c.startMs > 50);
}

export function overallConfidence(words: TranscriptWord[]): number | null {
  const confs = words.map((w) => w.confidence).filter((c): c is number => c !== null);
  if (!confs.length) return null;
  return Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000;
}
