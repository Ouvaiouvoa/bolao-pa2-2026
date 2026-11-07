import { describe, expect, it } from "vitest";
import { checkTransition, HAPPY_PATH, JOB_STATES, TRANSITIONS } from "@cmf/schemas";

describe("job state machine (section 7)", () => {
  it("allows the documented happy path with the right actors", () => {
    const humans = new Set(["INGESTING", "SCRIPTING", "ASSEMBLING", "APPROVED", "FINAL_RENDERING", "DELIVERED"]);
    for (let i = 2; i < HAPPY_PATH.length; i++) {
      const from = HAPPY_PATH[i - 1]!;
      const to = HAPPY_PATH[i]!;
      const actor = (from === "AWAITING_BRIEF_APPROVAL" && to === "SCRIPTING") || (from === "AWAITING_SCRIPT_APPROVAL" && to === "ASSEMBLING") || (from === "IN_REVIEW" && to === "APPROVED") || (from === "APPROVED" && to === "FINAL_RENDERING") || (from === "READY_TO_DELIVER" && to === "DELIVERED") || (from === "ASSETS_UPLOADING" && to === "INGESTING") ? "human" : "system";
      expect(checkTransition(from, to, actor).ok, `${from}→${to}`).toBe(true);
      void humans;
    }
  });
  it("never lets the system approve or deliver", () => {
    expect(checkTransition("IN_REVIEW", "APPROVED", "system").ok).toBe(false);
    expect(checkTransition("READY_TO_DELIVER", "DELIVERED", "system").ok).toBe(false);
    expect(checkTransition("AWAITING_SCRIPT_APPROVAL", "ASSEMBLING", "system").ok).toBe(false);
  });
  it("rejects undeclared transitions", () => {
    expect(checkTransition("DRAFT", "DELIVERED", "human").ok).toBe(false);
    expect(checkTransition("DELIVERED", "DRAFT", "human").ok).toBe(false);
    expect(checkTransition("QA_CHECKING", "DELIVERED", "system").ok).toBe(false);
  });
  it("declares rules for every state and approvals on gate transitions", () => {
    for (const s of JOB_STATES) expect(TRANSITIONS[s]).toBeDefined();
    expect(TRANSITIONS.READY_TO_DELIVER.find((r) => r.to === "DELIVERED")?.requiresApproval).toBe("render_master");
    expect(TRANSITIONS.IN_REVIEW.find((r) => r.to === "APPROVED")?.requiresApproval).toBe("render_preview");
  });
});
