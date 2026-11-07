import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import type { ActorType, EventEnvelope, EventType } from "@cmf/schemas";
import { getPublisher } from "./redis";

export interface EmitEventInput {
  organizationId: string;
  projectId: string | null;
  actorType: ActorType;
  actorId: string;
  eventType: EventType;
  payload?: Record<string, unknown>;
  traceId?: string | null;
}

export const projectChannel = (projectId: string) => `cmf:events:project:${projectId}`;
export const orgChannel = (orgId: string) => `cmf:events:org:${orgId}`;

/**
 * Persists the event in audit_events (source of truth) and then notifies live listeners.
 * Live notification is best effort; SSE clients always re-read from the database.
 */
export async function emitEvent(db: Db, input: EmitEventInput): Promise<EventEnvelope> {
  const [row] = await db
    .insert(tables.auditEvents)
    .values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: input.eventType,
      payloadJson: input.payload ?? {},
      traceId: input.traceId ?? null,
    })
    .returning();
  const envelope = toEnvelope(row!);
  const pub = getPublisher();
  if (pub) {
    const msg = String(envelope.id);
    void Promise.all([
      input.projectId ? pub.publish(projectChannel(input.projectId), msg) : Promise.resolve(0),
      pub.publish(orgChannel(input.organizationId), msg),
    ]).catch(() => undefined);
  }
  return envelope;
}

export function toEnvelope(row: typeof tables.auditEvents.$inferSelect): EventEnvelope {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    eventType: row.eventType as EventType,
    payload: (row.payloadJson ?? {}) as Record<string, unknown>,
    traceId: row.traceId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProjectEvents(db: Db, organizationId: string, projectId: string, afterId = 0, limit = 500): Promise<EventEnvelope[]> {
  const rows = await db
    .select()
    .from(tables.auditEvents)
    .where(and(eq(tables.auditEvents.organizationId, organizationId), eq(tables.auditEvents.projectId, projectId), gt(tables.auditEvents.id, afterId)))
    .orderBy(asc(tables.auditEvents.id))
    .limit(limit);
  return rows.map(toEnvelope);
}
