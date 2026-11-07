import { addBriefVersion } from "@cmf/orchestration";
import { CreateBriefRequest } from "@cmf/schemas";
import { actor, body, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("brief.edit", async ({ req, params, user, requestId }) => {
  const input = await body(req, CreateBriefRequest);
  return ok(await addBriefVersion(db(), actor(user), params.id, input.content), requestId, 201);
});
