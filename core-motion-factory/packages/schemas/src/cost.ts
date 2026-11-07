import { z } from "zod";

/** Per-project limits (section 22). All money values are in US cents and may be fractional. */
export const CostPolicySchema = z.strictObject({
  maxAiCostCents: z.number().min(0).max(1_000_000).default(500),
  maxRenderCostCents: z.number().min(0).max(1_000_000).default(300),
  maxTotalCostCents: z.number().min(0).max(2_000_000).default(1000),
  maxRevisionRounds: z.number().int().min(0).max(20).default(3),
  maxAgentSteps: z.number().int().min(5).max(500).default(120),
  deadlineAt: z.string().datetime().nullable().default(null),
});
export type CostPolicy = z.infer<typeof CostPolicySchema>;

export const DEFAULT_COST_POLICY: CostPolicy = CostPolicySchema.parse({});

export interface CostSnapshot {
  aiCents: number;
  renderCents: number;
  totalCents: number;
  agentSteps: number;
  revisionRounds: number;
}

export type BudgetDimension = "ai" | "render" | "total" | "agent_steps" | "revision_rounds" | "deadline";

export interface BudgetCheck {
  ok: boolean;
  dimension?: BudgetDimension;
  message?: string;
  projected?: number;
  limit?: number;
}

/**
 * Decides whether an operation with an estimated cost may start.
 * Pure function — the orchestrator calls it before every expensive step.
 */
export function checkBudget(
  policy: CostPolicy,
  spent: CostSnapshot,
  estimate: { aiCents?: number; renderCents?: number; agentSteps?: number; revisionRounds?: number },
  now: Date = new Date(),
): BudgetCheck {
  const ai = spent.aiCents + (estimate.aiCents ?? 0);
  const render = spent.renderCents + (estimate.renderCents ?? 0);
  const total = spent.totalCents + (estimate.aiCents ?? 0) + (estimate.renderCents ?? 0);
  const steps = spent.agentSteps + (estimate.agentSteps ?? 0);
  const rounds = spent.revisionRounds + (estimate.revisionRounds ?? 0);
  if (estimate.aiCents && ai > policy.maxAiCostCents)
    return { ok: false, dimension: "ai", projected: ai, limit: policy.maxAiCostCents, message: `custo de IA projetado ${ai.toFixed(2)}¢ excede o limite ${policy.maxAiCostCents}¢` };
  if (estimate.renderCents && render > policy.maxRenderCostCents)
    return { ok: false, dimension: "render", projected: render, limit: policy.maxRenderCostCents, message: `custo de render projetado ${render.toFixed(2)}¢ excede o limite ${policy.maxRenderCostCents}¢` };
  if ((estimate.aiCents || estimate.renderCents) && total > policy.maxTotalCostCents)
    return { ok: false, dimension: "total", projected: total, limit: policy.maxTotalCostCents, message: `custo total projetado ${total.toFixed(2)}¢ excede o limite ${policy.maxTotalCostCents}¢` };
  if (estimate.agentSteps && steps > policy.maxAgentSteps)
    return { ok: false, dimension: "agent_steps", projected: steps, limit: policy.maxAgentSteps, message: `número de passos de agentes (${steps}) excede o limite ${policy.maxAgentSteps}` };
  if (estimate.revisionRounds && rounds > policy.maxRevisionRounds)
    return { ok: false, dimension: "revision_rounds", projected: rounds, limit: policy.maxRevisionRounds, message: `rodadas de revisão (${rounds}) excedem o limite ${policy.maxRevisionRounds}` };
  if (policy.deadlineAt && now.getTime() > Date.parse(policy.deadlineAt))
    return { ok: false, dimension: "deadline", message: `prazo ${policy.deadlineAt} expirado` };
  return { ok: true };
}

/** Model price table in US dollars per million tokens (input/output). Used to compute cost per call. */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "heuristic-v1": { input: 0, output: 0 },
};

export function tokenCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const price = MODEL_PRICES_USD_PER_MTOK[model];
  if (!price) return 0;
  return ((tokensIn * price.input + tokensOut * price.output) / 1_000_000) * 100;
}
