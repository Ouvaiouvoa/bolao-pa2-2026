import { can, PERMISSIONS } from "@cmf/schemas";
import { route } from "@/lib/server/api";

export const GET = route(null, async ({ user }) => ({ ...user, permissions: PERMISSIONS.filter((p) => can(user.role, p)) }));
