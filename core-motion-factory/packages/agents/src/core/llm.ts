import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { tokenCostCents } from "@cmf/schemas";

/**
 * Optional LLM assistance for agents (Claude via the official SDK, structured outputs).
 * The deterministic engine is always the baseline: an LLM result is used only after it
 * passes schema validation and the agent's own guards (e.g. it can only reference
 * footage that exists in the selects).
 */

export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export interface LlmClient {
  readonly provider: string;
  generateObject<T extends z.ZodType>(opts: {
    tier: "default" | "small";
    system: string;
    prompt: string;
    schema: T;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
  }): Promise<{ data: z.infer<T>; usage: LlmUsage }>;
}

export class LlmRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRefusalError";
  }
}

export class AnthropicLlmClient implements LlmClient {
  readonly provider = "anthropic";
  private readonly client: Anthropic;
  constructor(
    private readonly models = {
      default: process.env.CMF_LLM_MODEL ?? "claude-opus-5-5",
      small: process.env.CMF_LLM_MODEL_SMALL ?? "claude-haiku-5-5",
    },
  ) {
    this.client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  }

  async generateObject<T extends z.ZodType>(opts: {
    tier: "default" | "small";
    system: string;
    prompt: string;
    schema: T;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
  }): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
    const model = this.models[opts.tier];
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
      // Server-side fallback on policy refusals (routes by refusal category).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new LlmRefusalError("o modelo recusou a solicitação");
    if (response.stop_reason === "max_tokens") throw new Error("resposta do modelo truncada (max_tokens)");
    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) throw new Error("resposta do modelo não corresponde ao schema");
    const check = opts.schema.safeParse(parsed);
    if (!check.success) throw new Error("resposta do modelo falhou na validação do schema");
    const usedModel = response.model ?? model;
    const tokensIn = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    const tokensOut = response.usage.output_tokens;
    return { data: check.data, usage: { model: usedModel, tokensIn, tokensOut, costCents: tokenCostCents(usedModel, tokensIn, tokensOut) } };
  }
}

/**
 * Returns an LLM client only when every gate is open:
 * project opted in, organisation policy allows external AI, and a key exists in the vault.
 */
export function createLlmClient(opts: { aiMode: "deterministic" | "llm_assisted"; allowExternal: boolean }): LlmClient | null {
  if (opts.aiMode !== "llm_assisted" || !opts.allowExternal) return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new AnthropicLlmClient();
}
