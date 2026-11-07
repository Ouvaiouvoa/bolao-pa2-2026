import { JOB_STATE_LABELS, type JobState } from "@cmf/schemas";
import { Badge } from "./ui";

const TONE: Partial<Record<JobState, "neutral" | "ok" | "warn" | "bad" | "info" | "accent">> = {
  DRAFT: "neutral",
  ASSETS_UPLOADING: "info",
  AWAITING_BRIEF_APPROVAL: "warn",
  AWAITING_SCRIPT_APPROVAL: "warn",
  IN_REVIEW: "warn",
  REVISION_REQUESTED: "warn",
  READY_TO_DELIVER: "warn",
  APPROVED: "ok",
  DELIVERED: "ok",
  BLOCKED: "bad",
};

export function StateBadge({ state, hold }: { state: JobState; hold?: boolean }) {
  return (
    <Badge tone={hold ? "bad" : (TONE[state] ?? "accent")}>
      {hold ? "⏸ " : ""}
      {JOB_STATE_LABELS[state] ?? state}
    </Badge>
  );
}
