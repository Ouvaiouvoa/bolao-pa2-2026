import { createComment } from "@cmf/orchestration";
import { CreateCommentRequest } from "@cmf/schemas";
import { actor, body, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("comment.create", async ({ req, params, user, requestId }) => {
  const input = await body(req, CreateCommentRequest);
  return ok({ id: await createComment(db(), actor(user), params.id, input) }, requestId, 201);
});
