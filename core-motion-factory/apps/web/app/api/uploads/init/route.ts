import { initUpload } from "@cmf/orchestration";
import { UploadInitRequest } from "@cmf/schemas";
import { actor, body, HttpError, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { can } from "@cmf/schemas";

export const POST = route(null, async ({ req, user, requestId }) => {
  const input = await body(req, UploadInitRequest);
  const perm = input.purpose === "project_media" ? "asset.upload" : "brand.manage";
  if (!can(user.role, perm)) throw new HttpError(403, "FORBIDDEN", `permissão necessária: ${perm}`);
  return ok(await initUpload(db(), actor(user), input), requestId, 201);
});
