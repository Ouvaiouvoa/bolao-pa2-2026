import { decideApproval } from "@cmf/orchestration";
import { can, CreateApprovalRequest, type Permission } from "@cmf/schemas";
import { actor, body, HttpError, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const REQUIRED: Record<string, Permission> = {
  brief: "brief.approve",
  script: "script.approve",
  render_preview: "preview.approve",
  render_master: "master.approve",
  compliance_report: "compliance.clear",
  budget: "budget.override",
};

/** Approval is a separate, explicit event — never inferred. */
export const POST = route(null, async ({ req, user, requestId }) => {
  const input = await body(req, CreateApprovalRequest);
  const perm = REQUIRED[input.artifactType]!;
  if (!can(user.role, perm)) throw new HttpError(403, "FORBIDDEN", `permissão necessária: ${perm}`);
  return ok(await decideApproval(db(), actor(user), input), requestId, 201);
});
