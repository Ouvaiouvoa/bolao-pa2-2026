import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@cmf/db";
import { tables } from "@cmf/db";
import { newId, type UploadInitRequest } from "@cmf/schemas";
import { getStorage, objectKeys } from "@cmf/storage";
import type { UserActor } from "./commands";
import { emitEvent } from "./events";
import { getBrand, getProject, NotFoundError, ValidationFailedError } from "./repos";
import { transitionProject } from "./state";

export const CHUNK_SIZE = 8 * 1024 * 1024;

const ALLOWED_MIME: Record<string, RegExp> = {
  project_media: /^(video|audio)\//,
  brand_logo: /^image\/(png|jpeg|webp)$/,
  brand_font: /^(font\/(woff2?|ttf|otf)|application\/(font-woff2?|x-font-ttf|octet-stream))$/,
  brand_music: /^audio\//,
};

/**
 * Starts a resumable multipart upload. Returns signed URLs for every part (short-lived),
 * so the browser uploads directly to storage (S3 presigned or the local signed endpoint).
 */
export async function initUpload(db: Db, user: UserActor, input: z.infer<typeof UploadInitRequest>) {
  if (!ALLOWED_MIME[input.purpose]!.test(input.mimeType))
    throw new ValidationFailedError("tipo de arquivo não permitido", [{ path: "mimeType", message: `${input.mimeType} não é aceito para ${input.purpose}` }]);
  const storage = getStorage();
  const targetId = input.purpose === "project_media" ? newId("asset") : newId("brandAsset");
  let key: string;
  let projectId: string | null = null;
  let brandId: string | null = null;
  if (input.purpose === "project_media") {
    if (!input.projectId) throw new ValidationFailedError("projectId obrigatório", [{ path: "projectId", message: "obrigatório" }]);
    const project = await getProject(db, user.organizationId, input.projectId);
    if (!["DRAFT", "ASSETS_UPLOADING"].includes(project.status)) throw new ValidationFailedError("projeto já iniciado", [{ path: "projectId", message: "materiais só podem ser enviados antes de iniciar" }]);
    projectId = project.id;
    key = objectKeys.assetOriginal(user.organizationId, project.id, targetId, input.fileName);
    if (project.status === "DRAFT") await transitionProject(db, { projectId: project.id, organizationId: user.organizationId, to: "ASSETS_UPLOADING", actor: { type: "system", id: "uploads" }, reason: "primeiro upload iniciado" });
  } else {
    if (!input.brandId) throw new ValidationFailedError("brandId obrigatório", [{ path: "brandId", message: "obrigatório" }]);
    const brand = await getBrand(db, user.organizationId, input.brandId);
    brandId = brand.row.id;
    key = objectKeys.brandAsset(user.organizationId, brand.row.id, targetId, input.fileName);
  }
  const storageUploadId = await storage.createMultipart(key, input.mimeType);
  const totalParts = Math.max(1, Math.ceil(input.sizeBytes / CHUNK_SIZE));
  const id = newId("upload");
  await db.insert(tables.uploads).values({
    id,
    organizationId: user.organizationId,
    projectId,
    brandId,
    purpose: input.purpose,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    chunkSize: CHUNK_SIZE,
    totalParts,
    objectKey: key,
    targetId,
    storageUploadId,
    createdBy: user.id,
  });
  const partUrls = [];
  for (let n = 1; n <= totalParts; n++) partUrls.push({ partNumber: n, url: await storage.partUploadUrl(key, storageUploadId, n, 3600) });
  if (projectId)
    await emitEvent(db, { organizationId: user.organizationId, projectId, actorType: "user", actorId: user.id, eventType: "asset.upload.started", payload: { uploadId: id, fileName: input.fileName, sizeBytes: input.sizeBytes } });
  return { uploadId: id, chunkSize: CHUNK_SIZE, totalParts, partUrls, driver: storage.driver };
}

export async function getUpload(db: Db, user: UserActor, uploadId: string) {
  const [u] = await db.select().from(tables.uploads).where(and(eq(tables.uploads.id, uploadId), eq(tables.uploads.organizationId, user.organizationId)));
  if (!u) throw new NotFoundError("upload");
  return u;
}

/** Parts already received — lets the client resume an interrupted upload. */
export async function uploadStatus(db: Db, user: UserActor, uploadId: string) {
  const u = await getUpload(db, user, uploadId);
  const parts = u.status === "pending" ? await getStorage().listParts(u.objectKey, u.storageUploadId) : [];
  return { uploadId: u.id, status: u.status, totalParts: u.totalParts, chunkSize: u.chunkSize, receivedParts: parts.map((p) => p.partNumber) };
}

async function sha256OfObject(key: string): Promise<{ checksum: string; size: number; head: Buffer }> {
  const local = await getStorage().materialize(key);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(local).on("data", (c) => hash.update(c)).on("end", () => resolve()).on("error", reject));
  const fh = await open(local, "r");
  const head = Buffer.alloc(16);
  await fh.read(head, 0, 16, 0);
  await fh.close();
  return { checksum: hash.digest("hex"), size: (await stat(local)).size, head };
}

/** Completes the multipart upload, verifies size, checksums the immutable original and registers it. */
export async function completeUpload(db: Db, user: UserActor, uploadId: string, clientParts?: { partNumber: number; etag: string }[]) {
  const u = await getUpload(db, user, uploadId);
  if (u.status !== "pending") throw new ValidationFailedError("upload já finalizado", [{ path: "uploadId", message: u.status }]);
  const storage = getStorage();
  // The server's own part listing is authoritative (works for resumed uploads on every driver).
  const listed = (await storage.listParts(u.objectKey, u.storageUploadId)).map((p) => ({ partNumber: p.partNumber, etag: p.etag }));
  const parts = listed.length >= (clientParts?.length ?? 0) ? listed : clientParts!;
  if (parts.length !== u.totalParts) throw new ValidationFailedError("upload incompleto", [{ path: "parts", message: `${parts.length}/${u.totalParts} partes recebidas` }]);
  await storage.completeMultipart(u.objectKey, u.storageUploadId, parts);
  const { checksum, size } = await sha256OfObject(u.objectKey);
  if (Math.abs(size - u.sizeBytes) > 0) {
    await db.update(tables.uploads).set({ status: "failed" }).where(eq(tables.uploads.id, u.id));
    throw new ValidationFailedError("tamanho divergente", [{ path: "sizeBytes", message: `esperado ${u.sizeBytes}, recebido ${size}` }]);
  }
  if (u.purpose === "project_media") {
    await db.insert(tables.assets).values({
      id: u.targetId,
      projectId: u.projectId!,
      organizationId: u.organizationId,
      type: u.mimeType.startsWith("audio/") ? "audio" : "video",
      originalName: u.fileName,
      mimeType: u.mimeType,
      objectKey: u.objectKey,
      sizeBytes: size,
      checksum,
      status: "uploaded",
    });
  } else {
    const type = u.purpose === "brand_logo" ? "logo" : u.purpose === "brand_font" ? "font" : "music";
    await db.insert(tables.brandAssets).values({
      id: u.targetId,
      brandId: u.brandId!,
      organizationId: u.organizationId,
      type,
      objectKey: u.objectKey,
      checksum,
      metadataJson: { originalName: u.fileName, mimeType: u.mimeType, sizeBytes: size, ...(type === "music" ? { origin: `upload de ${user.id} (licença declarada pela marca)` } : {}) },
    });
  }
  await db.update(tables.uploads).set({ status: "completed", completedAt: new Date() }).where(eq(tables.uploads.id, u.id));
  await emitEvent(db, {
    organizationId: u.organizationId,
    projectId: u.projectId,
    actorType: "user",
    actorId: user.id,
    eventType: u.projectId ? "asset.uploaded" : "brand.updated",
    payload: { uploadId: u.id, assetId: u.targetId, fileName: u.fileName, sizeBytes: size, checksum },
  });
  return { assetId: u.targetId, checksum, sizeBytes: size };
}

/** Server-side upload of a local file through the exact same multipart path (scripts/tests). */
export async function uploadLocalFile(db: Db, user: UserActor, input: Omit<z.infer<typeof UploadInitRequest>, "sizeBytes"> & { path: string }) {
  const size = (await stat(input.path)).size;
  const init = await initUpload(db, user, { projectId: input.projectId, brandId: input.brandId, purpose: input.purpose, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: size });
  const storage = getStorage();
  const u = await getUpload(db, user, init.uploadId);
  for (let n = 1; n <= init.totalParts; n++) {
    const start = (n - 1) * init.chunkSize;
    const end = Math.min(size, start + init.chunkSize) - 1;
    await storage.writePart(u.storageUploadId, n, createReadStream(input.path, { start, end }));
  }
  return completeUpload(db, user, init.uploadId);
}

/** Fresh signed part URLs for an unfinished upload (resume after interruption/expiry). */
export async function resignUpload(db: Db, user: UserActor, uploadId: string) {
  const u = await getUpload(db, user, uploadId);
  if (u.status !== "pending") throw new ValidationFailedError("upload não está pendente", [{ path: "uploadId", message: u.status }]);
  const storage = getStorage();
  const received = (await storage.listParts(u.objectKey, u.storageUploadId)).map((p) => p.partNumber);
  const partUrls = [];
  for (let n = 1; n <= u.totalParts; n++) if (!received.includes(n)) partUrls.push({ partNumber: n, url: await storage.partUploadUrl(u.objectKey, u.storageUploadId, n, 3600) });
  return { uploadId: u.id, chunkSize: u.chunkSize, totalParts: u.totalParts, partUrls, receivedParts: received, driver: storage.driver };
}
