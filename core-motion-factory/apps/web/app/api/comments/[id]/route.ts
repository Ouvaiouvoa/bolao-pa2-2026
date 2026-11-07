import { updateComment } from "@cmf/orchestration";
import { UpdateCommentRequest } from "@cmf/schemas";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const PATCH = route<{ id: string }>("comment.create", async ({ req, params, user }) => {
  const input = await body(req, UpdateCommentRequest);
  if (input.status && input.status !== "open" && !["admin", "director", "editor", "reviewer"].includes(user.role)) throw new Error("sem permissão para resolver comentários");
  await updateComment(db(), actor(user), params.id, input);
  return { id: params.id };
});
