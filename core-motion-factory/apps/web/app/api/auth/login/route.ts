import { NextResponse } from "next/server";
import { login } from "@cmf/orchestration";
import { LoginRequest } from "@cmf/schemas";
import { body, publicRoute } from "@/lib/server/api";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const POST = publicRoute(async ({ req, requestId }) => {
  const input = await body(req, LoginRequest);
  const session = await login(db(), input.email, input.password);
  const res = NextResponse.json({ data: { ok: true }, request_id: requestId });
  res.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: session.expiresAt });
  return res;
});
