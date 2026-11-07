import { z } from "zod";
import { requestRevision } from "@cmf/orchestration";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const Req = z.strictObject({ reason: z.string().min(3).max(1000) });

export const POST = route<{ id: string }>("comment.create", async ({ req, params, user }) => {
  const { reason } = await body(req, Req);
  return requestRevision(db(), actor(user), params.id, reason);
});
