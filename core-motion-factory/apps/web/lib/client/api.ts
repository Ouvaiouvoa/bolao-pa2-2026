"use client";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly requestId?: string) {
    super(message);
  }
}

function newIdempotencyKey(): string {
  return `idem_${crypto.randomUUID()}`;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotent) headers["Idempotency-Key"] = newIdempotencyKey();
  const res = await fetch(path, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string; details?: unknown }; request_id?: string };
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "HTTP_" + res.status, json.error?.message ?? res.statusText, json.error?.details, json.request_id);
  return json.data as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const d = Array.isArray(err.details) ? (err.details as { path?: string; message?: string }[]).slice(0, 3).map((x) => `${x.path ? x.path + ": " : ""}${x.message}`).join("; ") : "";
    return `${err.message}${d ? ` — ${d}` : ""}${err.requestId ? ` (req ${err.requestId.slice(0, 8)})` : ""}`;
  }
  return (err as Error)?.message ?? String(err);
}
