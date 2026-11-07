import { z } from "zod";
import { completeUpload } from "@cmf/orchestration";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const Req = z.strictObject({ parts: z.array(z.strictObject({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(200) })).max(10_000).default([]) });

export const POST = route<{ id: string }>(null, async ({ req, params, user }) => {
  const input = await body(req, Req);
  return completeUpload(db(), actor(user), params.id, input.parts);
});
