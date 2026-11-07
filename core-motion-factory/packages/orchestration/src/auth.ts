import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import { newId, type Role } from "@cmf/schemas";
import { emitEvent } from "./events";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { ...PARAMS, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(tables.sessions).values({ id: newId("session"), userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(tables.sessions).where(eq(tables.sessions.tokenHash, sha256(token)));
}

export interface SessionUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  organizationName: string;
}

export async function getSessionUser(db: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ u: tables.users, o: tables.organizations })
    .from(tables.sessions)
    .innerJoin(tables.users, eq(tables.users.id, tables.sessions.userId))
    .innerJoin(tables.organizations, eq(tables.organizations.id, tables.users.organizationId))
    .where(and(eq(tables.sessions.tokenHash, sha256(token)), gt(tables.sessions.expiresAt, new Date())));
  if (!row || row.u.status !== "active" || row.o.status !== "active") return null;
  return { id: row.u.id, organizationId: row.u.organizationId, name: row.u.name, email: row.u.email, role: row.u.role as Role, organizationName: row.o.name };
}

export class AuthError extends Error {
  constructor(message: string, readonly code = "AUTH") {
    super(message);
    this.name = "AuthError";
  }
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/** Creates an organization with its first admin (multi-tenant signup). */
export async function signupOrganization(db: Db, input: { organizationName: string; name: string; email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const [exists] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, email));
  if (exists) throw new AuthError("e-mail já cadastrado", "EMAIL_TAKEN");
  const orgId = newId("organization");
  const userId = newId("user");
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (trx) => {
    await trx.insert(tables.organizations).values({
      id: orgId,
      name: input.organizationName,
      slug: `${slugify(input.organizationName) || "org"}-${orgId.slice(-6)}`,
      settingsJson: { ai: { allowExternalProviders: false, allowTrainingOnCustomerData: false }, retentionDays: 365 },
    });
    await trx.insert(tables.users).values({ id: userId, organizationId: orgId, name: input.name, email, role: "admin", passwordHash });
  });
  await emitEvent(db, { organizationId: orgId, projectId: null, actorType: "user", actorId: userId, eventType: "user.login", payload: { action: "signup" } });
  return { organizationId: orgId, userId };
}

export async function createUser(db: Db, organizationId: string, input: { name: string; email: string; role: Role; password: string }) {
  const email = input.email.trim().toLowerCase();
  const [exists] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, email));
  if (exists) throw new AuthError("e-mail já cadastrado", "EMAIL_TAKEN");
  const id = newId("user");
  await db.insert(tables.users).values({ id, organizationId, name: input.name, email, role: input.role, passwordHash: await hashPassword(input.password) });
  return id;
}

export async function login(db: Db, email: string, password: string) {
  const [user] = await db.select().from(tables.users).where(eq(tables.users.email, email.trim().toLowerCase()));
  // Constant-ish work even when the user does not exist.
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  if (!user || !ok || user.status !== "active") throw new AuthError("credenciais inválidas", "INVALID_CREDENTIALS");
  const session = await createSession(db, user.id);
  await emitEvent(db, { organizationId: user.organizationId, projectId: null, actorType: "user", actorId: user.id, eventType: "user.login", payload: { action: "login" } });
  return session;
}
