import type { TranscriptPayload, TranscriptWord } from "@cmf/schemas";

export interface AsrChunkResult {
  words: TranscriptWord[];
  text: string;
}

export interface TranscriptionRequest {
  assetId: string;
  wavPath: string;
  durationMs: number;
  language: string;
  /** Silence ranges used to choose chunk boundaries for long audio. */
  silences: { startMs: number; endMs: number }[];
  onProgress?: (fraction: number) => void;
}

export interface TranscriptionResult extends TranscriptPayload {
  /** Billable units for cost tracking. */
  usage: { audioSeconds: number; costCents: number };
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly model: string;
  /** True when audio leaves the infrastructure (needs organisation AI policy approval). */
  readonly external: boolean;
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>;
}
