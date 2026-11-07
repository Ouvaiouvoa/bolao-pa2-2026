import { route } from "@/lib/server/api";
import { loadProjectSnapshot } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>("project.view", async ({ params, user }) => loadProjectSnapshot(user, params.id));
