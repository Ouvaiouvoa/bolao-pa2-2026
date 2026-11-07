import { z } from "zod";

/** Section 14 — real-time events. Every event is persisted in audit_events before being streamed. */
export const EVENT_TYPES = [
  "project.created",
  "project.updated",
  "project.state.changed",
  "brief.version.created",
  "asset.upload.started",
  "asset.uploaded",
  "asset.ingest.started",
  "asset.proxy.ready",
  "asset.ingest.failed",
  "transcript.completed",
  "transcript.edited",
  "agent.run.started",
  "agent.run.progress",
  "agent.run.blocked",
  "agent.run.failed",
  "agent.run.completed",
  "agent.run.cached",
  "agent.run.retry_requested",
  "agent.artifact.created",
  "agent.tool.called",
  "edit_plan.version.created",
  "render.preview.started",
  "render.preview.completed",
  "render.final.started",
  "render.final.completed",
  "render.failed",
  "review.comment.created",
  "review.comment.updated",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "budget.blocked",
  "compliance.clearance.reused",
  "qa.completed",
  "qa.blocked",
  "delivery.ready",
  "delivery.completed",
  "user.login",
  "brand.updated",
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const ActorType = z.enum(["user", "agent", "system"]);
export type ActorType = z.infer<typeof ActorType>;

export interface EventEnvelope<P = Record<string, unknown>> {
  id: number;
  organizationId: string;
  projectId: string | null;
  actorType: ActorType;
  actorId: string;
  eventType: EventType;
  payload: P;
  traceId: string | null;
  createdAt: string;
}
