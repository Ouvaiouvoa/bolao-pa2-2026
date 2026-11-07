import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { AuthError, getPublisher, NotFoundError, TransitionError, ValidationFailedError, type SessionUser } from "@cmf/orchestration";
import { rootLogger } from "@cmf/observability";
import { can, type Permission } from "@cmf/schemas";
import { currentUser } from "./auth";

const log = rootLogger.child({ service: "cmf-web" });

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

type Ctx<P> = { params: Promise<P> };

interface HandlerArgs<P> {
  req: NextRequest;
  params: P;
  user: SessionUser;
  requestId: string;
}

function errorResponse(err: unknown, requestId: string): NextResponse {
  let status = 500;
  let code = "INTERNAL";
  let message = "erro interno";
  let details: unknown;
  if (err instanceof HttpError) [status, code, message, details] = [err.status, err.code, err.message, err.details];
  else if (err instanceof ZodError) [status, code, message, details] = [400, "INVALID_INPUT", "entrada inválida", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))];
  else if (err instanceof ValidationFailedError) [status, code, message, details] = [422, "VALIDATION_FAILED", err.message, err.issues];
  else if (err instanceof NotFoundError) [status, code, message] = [404, "NOT_FOUND", err.message];
  else if (err instanceof TransitionError) [status, code, message] = [err.code === "FORBIDDEN" ? 403 : 409, err.code, err.message];
  else if (err instanceof AuthError) [status, code, message] = [err.code === "EMAIL_TAKEN" ? 409 : 401, err.code, err.message];
  if (status >= 500) log.error("request.failed", { requestId, error: (err as Error)?.message, name: (err as Error)?.name });
  // Never expose stack traces to the client.
  return NextResponse.json({ error: { code, message, details }, request_id: requestId }, { status, headers: { "x-request-id": requestId } });
}

export function ok(data: unknown, requestId: string, status = 200): NextResponse {
  return NextResponse.json({ data, request_id: requestId }, { status, headers: { "x-request-id": requestId } });
}

/** Idempotency for critical commands: same Idempotency-Key → same response (24h, per user). */
async function withIdempotency(req: NextRequest, user: SessionUser, run: () => Promise<NextResponse>): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key");
  const redis = getPublisher();
  if (!key || !redis || req.method === "GET") return run();
  if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key inválida");
  const rkey = `cmf:idem:${user.id}:${req.method}:${new URL(req.url).pathname}:${key}`;
  const cached = await redis.get(rkey).catch(() => null);
  if (cached) {
    const { status, body } = JSON.parse(cached) as { status: number; body: unknown };
    return NextResponse.json(body, { status, headers: { "idempotent-replay": "true" } });
  }
  const res = await run();
  if (res.status < 500) {
    const body = await res.clone().json();
    await redis.set(rkey, JSON.stringify({ status: res.status, body }), "EX", 86400).catch(() => undefined);
  }
  return res;
}

/** Authenticated route handler with RBAC, request_id, standard errors and idempotency. */
export function route<P = Record<string, string>>(permission: Permission | null, handler: (args: HandlerArgs<P>) => Promise<NextResponse | unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<NextResponse> => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    try {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "sessão inválida ou expirada");
      if (permission && !can(user.role, permission)) throw new HttpError(403, "FORBIDDEN", `permissão necessária: ${permission}`);
      const params = (await ctx.params) ?? ({} as P);
      return await withIdempotency(req, user, async () => {
        const result = await handler({ req, params, user, requestId });
        return result instanceof NextResponse ? result : ok(result, requestId);
      });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

/** Unauthenticated route (login/signup/health). */
export function publicRoute<P = Record<string, string>>(handler: (args: { req: NextRequest; params: P; requestId: string }) => Promise<NextResponse | unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<NextResponse> => {
    const requestId = randomUUID();
    try {
      const params = (await ctx.params) ?? ({} as P);
      const result = await handler({ req, params, requestId });
      return result instanceof NextResponse ? result : ok(result, requestId);
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export async function body<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "corpo da requisição não é JSON válido");
  }
  return schema.parse(json);
}

export function actor(user: SessionUser) {
  return { id: user.id, organizationId: user.organizationId, role: user.role };
}

/** Cursor pagination helper: cursor = ISO timestamp of the last item. */
export function pageParams(req: NextRequest): { limit: number; cursor: Date | null } {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25)));
  const c = url.searchParams.get("cursor");
  const cursor = c && !Number.isNaN(Date.parse(c)) ? new Date(c) : null;
  return { limit, cursor };
}
