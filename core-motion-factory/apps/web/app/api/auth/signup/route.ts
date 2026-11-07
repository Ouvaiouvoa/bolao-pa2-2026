import { NextResponse } from "next/server";
import { createSession, signupOrganization } from "@cmf/orchestration";
import { SignupRequest } from "@cmf/schemas";
import { body, publicRoute } from "@/lib/server/api";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const POST = publicRoute(async ({ req, requestId }) => {
  const input = await body(req, SignupRequest);
  const { userId, organizationId } = await signupOrganization(db(), input);
  const session = await createSession(db(), userId);
  const res = NextResponse.json({ data: { userId, organizationId }, request_id: requestId }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: session.expiresAt });
  return res;
});
