import { describe, expect, it } from "vitest";
import { checkBudget, CostPolicySchema, tokenCostCents } from "@cmf/schemas";

const policy = CostPolicySchema.parse({ maxAiCostCents: 100, maxRenderCostCents: 50, maxTotalCostCents: 120, maxRevisionRounds: 2, maxAgentSteps: 10 });
const spent = { aiCents: 90, renderCents: 40, totalCents: 130, agentSteps: 9, revisionRounds: 2 };

describe("cost policies (section 22)", () => {
  it("blocks the exceeded dimension before running", () => {
    expect(checkBudget(policy, { ...spent, totalCents: 0 }, { aiCents: 20 }).dimension).toBe("ai");
    expect(checkBudget(policy, { ...spent, totalCents: 0 }, { renderCents: 20 }).dimension).toBe("render");
    expect(checkBudget(policy, { ...spent, aiCents: 0, renderCents: 0 }, { aiCents: 5 }).dimension).toBe("total");
    expect(checkBudget(policy, spent, { agentSteps: 2 }).dimension).toBe("agent_steps");
    expect(checkBudget(policy, spent, { revisionRounds: 1 }).dimension).toBe("revision_rounds");
  });
  it("allows work within limits and checks deadlines", () => {
    expect(checkBudget(policy, { aiCents: 0, renderCents: 0, totalCents: 0, agentSteps: 0, revisionRounds: 0 }, { aiCents: 10, agentSteps: 1 }).ok).toBe(true);
    const late = CostPolicySchema.parse({ deadlineAt: "2020-01-01T00:00:00.000Z" });
    expect(checkBudget(late, { aiCents: 0, renderCents: 0, totalCents: 0, agentSteps: 0, revisionRounds: 0 }, {}).dimension).toBe("deadline");
  });
  it("prices model tokens per million", () => {
    expect(tokenCostCents("claude-opus-5-5", 1_000_000, 0)).toBeCloseTo(400);
    expect(tokenCostCents("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(60);
    expect(tokenCostCents("heuristic-v1", 5000, 5000)).toBe(0);
  });
});
