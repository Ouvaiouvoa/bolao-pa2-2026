import { resignUpload } from "@cmf/orchestration";
import { actor, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>(null, async ({ params, user }) => resignUpload(db(), actor(user), params.id));
