import path from "node:path";
import { OpenAiTranscriptionProvider } from "./openai";
import { SherpaParakeetProvider } from "./sherpa";
import type { TranscriptionProvider } from "./types";

export * from "./types";
export * from "./words";
export { SherpaParakeetProvider } from "./sherpa";
export { OpenAiTranscriptionProvider } from "./openai";

export function defaultModelsDir(): string {
  return process.env.CMF_MODELS_DIR ?? path.resolve(process.cwd(), ".models");
}

/**
 * Provider selection (CMF_ASR_PROVIDER):
 *  - "sherpa-local" (default): on-premise Parakeet model, no data leaves the server.
 *  - "openai": external API — requires OPENAI_API_KEY and an org policy allowing external AI.
 */
export function createTranscriptionProvider(opts: { allowExternal: boolean }): TranscriptionProvider {
  const id = process.env.CMF_ASR_PROVIDER ?? "sherpa-local";
  if (id === "openai") {
    if (!opts.allowExternal) throw new Error("política da organização não permite provedores externos de IA para transcrição");
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY não configurada");
    return new OpenAiTranscriptionProvider(key);
  }
  if (id !== "sherpa-local") throw new Error(`provedor de transcrição desconhecido: ${id}`);
  const modelDir = process.env.CMF_ASR_MODEL_DIR ?? path.join(defaultModelsDir(), "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
  return new SherpaParakeetProvider(modelDir);
}
