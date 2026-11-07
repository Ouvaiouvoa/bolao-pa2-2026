import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { readWavFloat32 } from "../transcode";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./types";
import { buildSegments, overallConfidence, planChunks, tokensToWords } from "./words";

interface SherpaResult {
  text: string;
  tokens: string[];
  timestamps: number[];
  durations?: number[];
  ys_log_probs?: number[];
}
interface SherpaStream {
  acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(s: SherpaStream): void;
  getResult(s: SherpaStream): SherpaResult;
}
interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
}

/**
 * Local ASR with sherpa-onnx + NVIDIA Parakeet TDT 0.6B v3 (25 European languages incl. pt).
 * Audio never leaves the machine. Gives token timestamps, durations and log-probs → word
 * timestamps and per-word confidence.
 */
export class SherpaParakeetProvider implements TranscriptionProvider {
  readonly id = "sherpa-local";
  readonly external = false;
  readonly model: string;
  private recognizer: SherpaRecognizer | null = null;

  constructor(private readonly modelDir: string, private readonly threads = Number(process.env.CMF_ASR_THREADS ?? 4)) {
    this.model = path.basename(modelDir);
  }

  static isAvailable(modelDir: string): boolean {
    return ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"].every((f) => existsSync(path.join(modelDir, f)));
  }

  private load(): SherpaRecognizer {
    if (this.recognizer) return this.recognizer;
    if (!SherpaParakeetProvider.isAvailable(this.modelDir))
      throw new Error(`modelo ASR ausente em ${this.modelDir} — execute "npm run models:install"`);
    const require = createRequire(import.meta.url);
    const sherpa = require("sherpa-onnx-node") as SherpaModule;
    const d = this.modelDir;
    this.recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: `${d}/encoder.int8.onnx`, decoder: `${d}/decoder.int8.onnx`, joiner: `${d}/joiner.int8.onnx` },
        tokens: `${d}/tokens.txt`,
        numThreads: this.threads,
        provider: "cpu",
        modelType: "nemo_transducer",
        debug: 0,
      },
    });
    return this.recognizer;
  }

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const rec = this.load();
    const { samples, sampleRate } = await readWavFloat32(req.wavPath);
    const totalMs = (samples.length / sampleRate) * 1000;
    const chunks = planChunks(totalMs, req.silences, 25_000);
    const words: TranscriptionResult["words"] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const a = Math.floor((c.startMs / 1000) * sampleRate);
      const b = Math.min(samples.length, Math.ceil((c.endMs / 1000) * sampleRate));
      const stream = rec.createStream();
      stream.acceptWaveform({ samples: samples.subarray(a, b), sampleRate });
      rec.decode(stream);
      const r = rec.getResult(stream);
      words.push(...tokensToWords({ tokens: r.tokens, timestamps: r.timestamps, durations: r.durations, logProbs: r.ys_log_probs }, c.startMs, c.endMs));
      req.onProgress?.((i + 1) / chunks.length);
      // Yield to the event loop between chunks (decode is synchronous native code).
      await new Promise((resolve) => setImmediate(resolve));
    }
    const segments = buildSegments(words);
    return {
      assetId: req.assetId,
      language: req.language,
      provider: this.id,
      model: this.model,
      durationMs: Math.round(totalMs),
      text: words.map((w) => w.text).join(" "),
      confidence: overallConfidence(words),
      segments,
      words,
      usage: { audioSeconds: totalMs / 1000, costCents: 0 },
    };
  }
}
