import { describe, expect, it } from "vitest";
import { validateEditPlan } from "@cmf/schemas";
import { assets, ctx, validPlan } from "./helpers";

const codes = (p: unknown, c = ctx()) => validateEditPlan(p, c).issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("edit_plan.json contract (section 12)", () => {
  it("accepts a valid plan", () => {
    const r = validateEditPlan(validPlan(), ctx());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("rejects unknown properties (strict)", () => {
    const p = validPlan() as unknown as Record<string, unknown>;
    p.extra = 1;
    expect(codes(p)).toContain("SCHEMA");
    const q = validPlan();
    (q.tracks[0]!.items[0] as unknown as Record<string, unknown>).hack = true;
    expect(codes(q)).toContain("SCHEMA");
  });
  it("rejects zero/negative durations and inverted source ranges", () => {
    const p = validPlan();
    p.tracks[0]!.items[0]!.durationInFrames = 0;
    expect(codes(p)).toContain("SCHEMA");
    const q = validPlan();
    const v = q.tracks[0]!.items[0] as { sourceStartMs: number; sourceEndMs: number };
    v.sourceEndMs = v.sourceStartMs - 10;
    expect(codes(q)).toContain("SOURCE_RANGE_INVALID");
  });
  it("rejects assets from another organization", () => {
    const p = validPlan();
    (p.tracks[0]!.items[0] as { assetId: string }).assetId = "ast_foreign";
    expect(codes(p)).toContain("ASSET_FOREIGN_ORG");
  });
  it("rejects colors and fonts outside the brand kit", () => {
    const p = validPlan();
    (p.tracks[2]!.items[0] as { color: string }).color = "#00FF00";
    expect(codes(p)).toContain("COLOR_NOT_IN_BRAND");
    const q = validPlan();
    (q.tracks[2]!.items[0] as { fontFamily?: string }).fontFamily = "Comic Sans";
    expect(codes(q)).toContain("FONT_NOT_APPROVED");
  });
  it("limits volume to a safe range", () => {
    const p = validPlan();
    (p.tracks[0]!.items[0] as { volume: number }).volume = 3;
    expect(codes(p)).toContain("SCHEMA");
  });
  it("respects the composition duration and safe areas", () => {
    const p = validPlan();
    p.tracks[2]!.items[0]!.durationInFrames = 400;
    expect(codes(p)).toContain("ITEM_EXCEEDS_COMPOSITION");
    const q = validPlan();
    (q.tracks[1]!.items[0] as { bottomPercent: number }).bottomPercent = 5;
    expect(codes(q)).toContain("TEXT_OUTSIDE_SAFE_AREA");
    const r = validPlan();
    (r.tracks[2]!.items[0] as { box: { x: number } }).box.x = 0;
    expect(codes(r)).toContain("TEXT_OUTSIDE_SAFE_AREA");
  });
  it("detects overlapping clips and source beyond the asset", () => {
    const p = validPlan();
    p.tracks[0]!.items[1]!.fromFrame = 100;
    expect(codes(p)).toContain("VIDEO_OVERLAP");
    const q = validPlan();
    const v = q.tracks[0]!.items[1] as { sourceStartMs: number; sourceEndMs: number };
    v.sourceStartMs = 38_000;
    v.sourceEndMs = 43_000;
    expect(codes(q, ctx({ assets: assets() }))).toContain("SOURCE_EXCEEDS_ASSET");
  });
  it("requires source duration to match the item duration (frame-exact)", () => {
    const p = validPlan();
    (p.tracks[0]!.items[0] as { sourceEndMs: number }).sourceEndMs = 9000;
    expect(codes(p)).toContain("SOURCE_DURATION_MISMATCH");
  });
});
