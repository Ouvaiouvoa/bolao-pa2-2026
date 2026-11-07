import { retryAgentRun } from "@cmf/orchestration";
import { AgentRetryRequest } from "@cmf/schemas";
import { actor, body, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route<{ id: string }>("agent.retry", async ({ req, params, user }) => {
  const input = await body(req, AgentRetryRequest);
  return retryAgentRun(db(), actor(user), params.id, input.reason);
});
