import { requestPreviewRender } from "@cmf/orchestration";
import { actor, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("render.preview", async ({ params, user }) => requestPreviewRender(db(), actor(user), params.id));
