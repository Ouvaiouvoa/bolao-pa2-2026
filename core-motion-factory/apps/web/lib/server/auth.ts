import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@cmf/orchestration";
import { can, type Permission } from "@cmf/schemas";
import { db } from "./db";

export const SESSION_COOKIE = "cmf_session";

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return getSessionUser(db(), store.get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirects to /login when there is no session. */
export async function requireUserPage(permission?: Permission): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/?forbidden=" + permission);
  return user;
}
