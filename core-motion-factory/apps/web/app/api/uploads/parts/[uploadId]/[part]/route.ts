import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { tables } from "@cmf/db";
import { getStorage, LocalObjectStorage } from "@cmf/storage";
import { currentUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";

/** Local-driver part upload endpoint (signed, short-lived). S3 deployments upload parts straight to the bucket. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ uploadId: string; part: string }> }) {
  const { uploadId: storageUploadId, part } = await ctx.params;
  const storage = getStorage();
  if (!(storage instanceof LocalObjectStorage)) return NextResponse.json({ error: { code: "NOT_LOCAL", message: "driver não suporta este endpoint" } }, { status: 400 });
  const url = new URL(req.url);
  const partNumber = Number(part);
  if (!storage.verifyPartSignature(storageUploadId, partNumber, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? ""))
    return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "assinatura inválida ou expirada" } }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "sessão expirada" } }, { status: 401 });
  const [u] = await db().select().from(tables.uploads).where(and(eq(tables.uploads.storageUploadId, storageUploadId), eq(tables.uploads.organizationId, user.organizationId)));
  if (!u || u.status !== "pending") return NextResponse.json({ error: { code: "NOT_FOUND", message: "upload inexistente" } }, { status: 404 });
  if (partNumber < 1 || partNumber > u.totalParts) return NextResponse.json({ error: { code: "INVALID_PART", message: "parte fora do intervalo" } }, { status: 400 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > u.chunkSize) return NextResponse.json({ error: { code: "PART_TOO_LARGE", message: "parte maior que o chunk" } }, { status: 413 });
  if (!req.body) return NextResponse.json({ error: { code: "EMPTY", message: "corpo vazio" } }, { status: 400 });
  const result = await storage.writePart(storageUploadId, partNumber, Readable.fromWeb(req.body as unknown as NodeWebStream));
  if (result.size > u.chunkSize) return NextResponse.json({ error: { code: "PART_TOO_LARGE", message: "parte maior que o chunk" } }, { status: 413 });
  return NextResponse.json({ data: result }, { headers: { ETag: result.etag } });
}
