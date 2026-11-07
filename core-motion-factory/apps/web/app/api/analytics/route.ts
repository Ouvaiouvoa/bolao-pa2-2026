import { route } from "@/lib/server/api";
import { analytics } from "@/lib/server/metrics";

export const dynamic = "force-dynamic";
export const GET = route("analytics.view", async ({ user }) => analytics(user.organizationId));
