import { readFile } from "node:fs/promises";
import type { TranscriptWord } from "@cmf/schemas";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./types";
import { buildSegments, overallConfidence } from "./words";

/**
 * External ASR via the OpenAI transcription endpoint (word granularity).
 * Only used when the organisation's AI policy allows external providers.
 * Price per minute is configurable (CMF_OPENAI_ASR_CENTS_PER_MIN).
 */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  readonly id = "openai";
  readonly external = true;
  constructor(
    private readonly apiKey: string,
    readonly model = process.env.CMF_OPENAI_ASR_MODEL ?? "whisper-1",
    private readonly baseUrl = process.env.CMF_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {}

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const audio = await readFile(req.wavPath);
    if (audio.length > 24 * 1024 * 1024) throw new Error("áudio excede 24MB; divida o material ou use o provedor local");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "audio.wav");
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.set("language", req.language.slice(0, 2));
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}` }, body: form });
    if (!res.ok) throw new Error(`OpenAI ASR falhou: HTTP ${res.status}`);
    const body = (await res.json()) as {
      text: string;
      language?: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
      segments?: { start: number; end: number; avg_logprob?: number }[];
    };
    const segConf = (ms: number) => {
      const s = body.segments?.find((x) => ms >= x.start * 1000 && ms <= x.end * 1000);
      return s?.avg_logprob !== undefined ? Math.round(Math.exp(s.avg_logprob) * 1000) / 1000 : null;
    };
    const words: TranscriptWord[] = (body.words ?? []).map((w) => ({
      text: w.word.trim(),
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      confidence: segConf(w.start * 1000),
    }));
    req.onProgress?.(1);
    const audioSeconds = body.duration ?? req.durationMs / 1000;
    const centsPerMin = Number(process.env.CMF_OPENAI_ASR_CENTS_PER_MIN ?? 0.6);
    return {
      assetId: req.assetId,
      language: req.language,
      provider: this.id,
      model: this.model,
      durationMs: Math.round(audioSeconds * 1000),
      text: body.text,
      confidence: overallConfidence(words),
      segments: buildSegments(words),
      words,
      usage: { audioSeconds, costCents: (audioSeconds / 60) * centsPerMin },
    };
  }
}
