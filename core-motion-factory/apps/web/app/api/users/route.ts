import { asc, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { createUser } from "@cmf/orchestration";
import { CreateUserRequest } from "@cmf/schemas";
import { body, ok, route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("users.manage", async ({ user }) => {
  const rows = await db().select().from(tables.users).where(eq(tables.users.organizationId, user.organizationId)).orderBy(asc(tables.users.createdAt));
  return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt.toISOString() }));
});

export const POST = route("users.manage", async ({ req, user, requestId }) => {
  const input = await body(req, CreateUserRequest);
  return ok({ id: await createUser(db(), user.organizationId, input) }, requestId, 201);
});
