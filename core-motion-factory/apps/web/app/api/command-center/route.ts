import { route } from "@/lib/server/api";
import { commandCenter } from "@/lib/server/metrics";

export const dynamic = "force-dynamic";
export const GET = route("project.view", async ({ user }) => commandCenter(user.organizationId));
