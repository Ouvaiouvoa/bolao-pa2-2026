import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES } from "@cmf/schemas";

describe("role-based permissions (section 4)", () => {
  it("admin has every permission", () => {
    for (const p of PERMISSIONS) expect(can("admin", p)).toBe(true);
  });
  it("client approver never sees costs, secrets or technical settings", () => {
    for (const p of ["cost.view", "providers.manage", "org.manage", "audit.view", "timeline.edit", "agent.retry"] as const) expect(can("client", p)).toBe(false);
    expect(can("client", "preview.approve")).toBe(true);
    expect(can("client", "master.approve")).toBe(true);
    expect(can("client", "comment.create")).toBe(true);
  });
  it("editor edits but does not approve; reviewer clears compliance", () => {
    expect(can("editor", "timeline.edit")).toBe(true);
    expect(can("editor", "master.approve")).toBe(false);
    expect(can("editor", "brief.approve")).toBe(false);
    expect(can("reviewer", "compliance.clear")).toBe(true);
    expect(can("director", "compliance.clear")).toBe(false);
    expect(can("director", "render.final")).toBe(true);
  });
  it("only admin overrides budgets and manages users", () => {
    for (const r of ROLES) {
      expect(can(r, "budget.override")).toBe(r === "admin");
      expect(can(r, "users.manage")).toBe(r === "admin");
    }
  });
});
