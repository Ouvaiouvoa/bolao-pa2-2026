import { uploadStatus } from "@cmf/orchestration";
import { actor, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route<{ id: string }>(null, async ({ params, user }) => uploadStatus(db(), actor(user), params.id));
