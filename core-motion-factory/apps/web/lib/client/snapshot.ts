"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventEnvelope } from "@cmf/schemas";
import type { ProjectSnapshot } from "@/lib/server/queries";
import { api } from "./api";
import { useProjectEvents } from "./events";

/** Live project snapshot: refetched (debounced) whenever a persisted event arrives over SSE. */
export function useProjectSnapshot(initial: ProjectSnapshot) {
  const [snap, setSnap] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSnap(await api<ProjectSnapshot>(`/api/projects/${initial.project.id}/snapshot`));
    } catch {
      /* keep last good snapshot */
    }
  }, [initial.project.id]);
  const onEvent = useCallback(
    (e: EventEnvelope) => {
      // Progress events are frequent: refresh at most every 1.5s for them.
      const delay = e.eventType === "agent.run.progress" ? 1500 : 300;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void refresh();
      }, delay);
    },
    [refresh],
  );
  const { events, connected } = useProjectEvents(initial.project.id, onEvent);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { snap, refresh, events, connected };
}
