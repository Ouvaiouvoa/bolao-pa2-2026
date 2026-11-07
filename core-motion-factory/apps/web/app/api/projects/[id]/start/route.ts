import { startProject } from "@cmf/orchestration";
import { actor, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("project.start", async ({ params, user }) => startProject(db(), actor(user), params.id));
