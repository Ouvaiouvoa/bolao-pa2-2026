import { createHash } from "node:crypto";
import type { EditPlan } from "@cmf/schemas";

export function hashOf(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => ((acc[k] = canonical((v as Record<string, unknown>)[k])), acc), {});
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 32);
}

/**
 * Content hash of the parts of an edit plan an agent consumes. Chained agents key their
 * checkpoints on content (not on version ids), so re-running a stage after a human gate
 * reuses every unchanged step instead of recomputing it.
 */
export function planPartsHash(plan: EditPlan, parts: ("composition" | "video" | "captions" | "motion" | "audio" | "all")[]): string {
  const pick: Record<string, unknown> = {};
  for (const p of parts) {
    if (p === "composition") pick.composition = plan.composition;
    else if (p === "all") pick.all = { ...plan, metadata: undefined };
    else if (p === "video")
      // Timing/content only: gain changes (Audio agent) must not invalidate caption/motion checkpoints.
      pick.video = (plan.tracks.find((t) => t.type === "video")?.items ?? []).map((i) =>
        "assetId" in i && "sourceStartMs" in i ? { assetId: i.assetId, fromFrame: i.fromFrame, durationInFrames: i.durationInFrames, sourceStartMs: i.sourceStartMs, sourceEndMs: i.sourceEndMs, beatId: i.beatId } : i,
      );
    else pick[p] = plan.tracks.find((t) => t.type === p)?.items ?? [];
  }
  return hashOf(pick);
}
