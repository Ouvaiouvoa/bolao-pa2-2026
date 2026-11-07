import { NextResponse, type NextRequest } from "next/server";
import { deleteSession } from "@cmf/orchestration";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db(), token);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
