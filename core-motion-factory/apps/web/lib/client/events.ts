"use client";
import { useEffect, useRef, useState } from "react";
import type { EventEnvelope } from "@cmf/schemas";

/** Subscribes to the project's SSE stream; returns every persisted event received (ordered). */
export function useProjectEvents(projectId: string, onEvent?: (e: EventEnvelope) => void): { events: EventEnvelope[]; connected: boolean } {
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    const src = new EventSource(`/api/projects/${projectId}/events`);
    const seen = new Set<number>();
    const handle = (msg: MessageEvent) => {
      try {
        const e = JSON.parse(msg.data) as EventEnvelope;
        if (seen.has(e.id)) return;
        seen.add(e.id);
        setEvents((prev) => [...prev, e]);
        cb.current?.(e);
      } catch {
        /* ignore malformed */
      }
    };
    src.onopen = () => setConnected(true);
    src.onerror = () => setConnected(false);
    src.onmessage = handle;
    const types = [
      "project.created","project.updated","project.state.changed","brief.version.created","asset.upload.started","asset.uploaded","asset.ingest.started","asset.proxy.ready","asset.ingest.failed","transcript.completed","transcript.edited","agent.run.started","agent.run.progress","agent.run.blocked","agent.run.failed","agent.run.completed","agent.run.cached","agent.run.retry_requested","agent.artifact.created","agent.tool.called","edit_plan.version.created","render.preview.started","render.preview.completed","render.final.started","render.final.completed","render.failed","review.comment.created","review.comment.updated","approval.requested","approval.granted","approval.rejected","budget.blocked","qa.completed","qa.blocked","delivery.ready","delivery.completed","user.login","brand.updated",
    ];
    for (const t of types) src.addEventListener(t, handle as EventListener);
    return () => src.close();
  }, [projectId]);
  return { events, connected };
}
