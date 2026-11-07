import type { NextRequest } from "next/server";
import { createSubscriber, getProject, listProjectEvents, projectChannel } from "@cmf/orchestration";
import { can } from "@cmf/schemas";
import { currentUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE stream of persisted project events (section 14). Clients resume with Last-Event-ID.
 * Redis pub/sub only signals "something new"; the payload always comes from the database.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("unauthenticated", { status: 401 });
  if (!can(user.role, "project.view")) return new Response("forbidden", { status: 403 });
  const { id } = await ctx.params;
  try {
    await getProject(db(), user.organizationId, id);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const url = new URL(req.url);
  let lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const hideCost = !can(user.role, "cost.view");
  let closed = false;
  const sub = createSubscriber();
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let flushing = false;
      let again = false;
      const flush = async () => {
        if (closed) return;
        if (flushing) {
          again = true;
          return;
        }
        flushing = true;
        try {
          do {
            again = false;
            const events = await listProjectEvents(db(), user.organizationId, id, lastId, 500);
            for (const e of events) {
              const payload = hideCost ? { ...e.payload, costCents: undefined } : e.payload;
              controller.enqueue(encoder.encode(`id: ${e.id}\nevent: ${e.eventType}\ndata: ${JSON.stringify({ ...e, payload })}\n\n`));
              lastId = e.id;
            }
            if (events.length === 500) again = true;
          } while (again && !closed);
        } catch {
          /* transient DB error: next tick retries */
        } finally {
          flushing = false;
        }
      };
      controller.enqueue(encoder.encode(`retry: 3000\n\n`));
      await flush();
      if (sub) {
        await sub.subscribe(projectChannel(id)).catch(() => undefined);
        sub.on("message", () => void flush());
      }
      // Safety net when Redis is unavailable or a notification is lost.
      timer = setInterval(() => void flush(), sub ? 5000 : 1500);
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      void sub?.quit().catch(() => undefined);
    },
  });
  req.signal.addEventListener("abort", () => {
    closed = true;
    if (timer) clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    void sub?.quit().catch(() => undefined);
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
