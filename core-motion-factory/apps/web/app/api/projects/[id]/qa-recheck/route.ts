import { recheckQa } from "@cmf/orchestration";
import { actor, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("render.final", async ({ params, user }) => recheckQa(db(), actor(user), params.id));
