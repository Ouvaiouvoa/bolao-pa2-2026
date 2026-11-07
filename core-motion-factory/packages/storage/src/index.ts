import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export * from "./keys";

/**
 * S3-compatible object storage abstraction.
 * - `local` driver: files under CMF_STORAGE_DIR, HMAC-signed short-lived URLs served by the web app.
 * - `s3` driver: any S3-compatible service (AWS S3, MinIO, R2) with presigned URLs and SSE.
 */

export interface ObjectStat {
  size: number;
  modifiedAt: Date;
}

export interface SignedUrlOptions {
  expiresInSec?: number;
  downloadName?: string;
}

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  putFile(key: string, sourcePath: string, opts?: { contentType?: string; immutable?: boolean }): Promise<void>;
  putBuffer(key: string, data: Buffer | string, opts?: { contentType?: string; immutable?: boolean }): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  /** Returns a local filesystem path with the object's content (direct for local, cached download for s3). */
  materialize(key: string): Promise<string>;
  stat(key: string): Promise<ObjectStat | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  openRead(key: string, range?: { start: number; end: number }): Promise<Readable>;
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;
  /** Multipart upload — resumable. */
  createMultipart(key: string, contentType: string): Promise<string>;
  partUploadUrl(key: string, uploadId: string, partNumber: number, expiresInSec?: number): Promise<string>;
  writePart(uploadId: string, partNumber: number, body: Readable | Buffer): Promise<{ etag: string; size: number }>;
  listParts(key: string, uploadId: string): Promise<{ partNumber: number; size: number; etag: string }[]>;
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
}

export class ObjectExistsError extends Error {
  constructor(key: string) {
    super(`objeto imutável já existe: ${key}`);
    this.name = "ObjectExistsError";
  }
}

function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || /[\0\r\n]/.test(key))
    throw new Error(`chave de objeto inválida: ${key}`);
}

export interface UrlSigner {
  sign(key: string, expiresAt: number, downloadName?: string): string;
  verify(key: string, expiresAt: number, signature: string, downloadName?: string, now?: number): boolean;
}

export function createUrlSigner(secret: string): UrlSigner {
  if (!secret || secret.length < 16) throw new Error("CMF_STORAGE_SIGNING_SECRET deve ter ao menos 16 caracteres");
  const mac = (key: string, exp: number, dn?: string) =>
    createHmac("sha256", secret).update(`${key}\n${exp}\n${dn ?? ""}`).digest("base64url");
  return {
    sign: mac,
    verify(key, exp, signature, dn, now = Date.now()) {
      if (!Number.isFinite(exp) || exp * 1000 < now) return false;
      const expected = Buffer.from(mac(key, exp, dn));
      const given = Buffer.from(signature);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}

export interface LocalStorageOptions {
  rootDir: string;
  publicBaseUrl: string;
  signingSecret: string;
  defaultExpiresInSec?: number;
}

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly signer: UrlSigner;
  constructor(private readonly opts: LocalStorageOptions) {
    this.signer = createUrlSigner(opts.signingSecret);
  }

  get rootDir(): string {
    return this.opts.rootDir;
  }

  pathFor(key: string): string {
    assertSafeKey(key);
    return path.join(this.opts.rootDir, "objects", key);
  }

  private uploadDir(uploadId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) throw new Error("uploadId inválido");
    return path.join(this.opts.rootDir, "multipart", uploadId);
  }

  private async guardImmutable(key: string, immutable?: boolean) {
    if (immutable && (await this.exists(key))) throw new ObjectExistsError(key);
  }

  async putFile(key: string, sourcePath: string, opts?: { contentType?: string; immutable?: boolean }) {
    await this.guardImmutable(key, opts?.immutable);
    const dest = this.pathFor(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    await copyFile(sourcePath, tmp);
    await rename(tmp, dest);
    if (opts?.immutable) await chmod(dest, 0o444);
  }

  async putBuffer(key: string, data: Buffer | string, opts?: { contentType?: string; immutable?: boolean }) {
    await this.guardImmutable(key, opts?.immutable);
    const dest = this.pathFor(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data);
    await rename(tmp, dest);
    if (opts?.immutable) await chmod(dest, 0o444);
  }

  async getBuffer(key: string) {
    return readFile(this.pathFor(key));
  }

  async materialize(key: string) {
    const p = this.pathFor(key);
    await stat(p);
    return p;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const s = await stat(this.pathFor(key));
      return { size: s.size, modifiedAt: s.mtime };
    } catch {
      return null;
    }
  }

  async exists(key: string) {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  async openRead(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.pathFor(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async signedUrl(key: string, opts?: SignedUrlOptions) {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + (opts?.expiresInSec ?? this.opts.defaultExpiresInSec ?? 900);
    const sig = this.signer.sign(key, exp, opts?.downloadName);
    const params = new URLSearchParams({ exp: String(exp), sig });
    if (opts?.downloadName) params.set("dn", opts.downloadName);
    return `${this.opts.publicBaseUrl.replace(/\/$/, "")}/api/files/${key.split("/").map(encodeURIComponent).join("/")}?${params}`;
  }

  verifySignedUrl(key: string, exp: number, sig: string, downloadName?: string): boolean {
    return this.signer.verify(key, exp, sig, downloadName);
  }

  async createMultipart(key: string, _contentType: string) {
    assertSafeKey(key);
    const uploadId = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await mkdir(this.uploadDir(uploadId), { recursive: true });
    await writeFile(path.join(this.uploadDir(uploadId), "key"), key);
    return uploadId;
  }

  async partUploadUrl(_key: string, uploadId: string, partNumber: number, expiresInSec = 3600) {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const scope = `multipart/${uploadId}/${partNumber}`;
    const sig = this.signer.sign(scope, exp);
    return `${this.opts.publicBaseUrl.replace(/\/$/, "")}/api/uploads/parts/${uploadId}/${partNumber}?exp=${exp}&sig=${sig}`;
  }

  verifyPartSignature(uploadId: string, partNumber: number, exp: number, sig: string): boolean {
    return this.signer.verify(`multipart/${uploadId}/${partNumber}`, exp, sig);
  }

  async writePart(uploadId: string, partNumber: number, body: Readable | Buffer) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new Error("partNumber inválido");
    const dir = this.uploadDir(uploadId);
    await stat(dir);
    const dest = path.join(dir, `part-${String(partNumber).padStart(5, "0")}`);
    const tmp = `${dest}.tmp`;
    if (Buffer.isBuffer(body)) await writeFile(tmp, body);
    else await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
    const s = await stat(dest);
    return { etag: `${partNumber}-${s.size}`, size: s.size };
  }

  async listParts(_key: string, uploadId: string) {
    const dir = this.uploadDir(uploadId);
    const files = (await readdir(dir)).filter((f) => /^part-\d{5}$/.test(f)).sort();
    const parts = [];
    for (const f of files) {
      const s = await stat(path.join(dir, f));
      const partNumber = Number(f.slice(5));
      parts.push({ partNumber, size: s.size, etag: `${partNumber}-${s.size}` });
    }
    return parts;
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    const dir = this.uploadDir(uploadId);
    const storedKey = (await readFile(path.join(dir, "key"), "utf8")).trim();
    if (storedKey !== key) throw new Error("multipart: chave não corresponde ao upload");
    const existing = await this.listParts(key, uploadId);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    ordered.forEach((p, i) => {
      if (p.partNumber !== i + 1) throw new Error(`multipart: parte ${i + 1} ausente`);
      const found = existing.find((e) => e.partNumber === p.partNumber);
      if (!found || found.etag !== p.etag) throw new Error(`multipart: etag inválido para parte ${p.partNumber}`);
    });
    if (await this.exists(key)) throw new ObjectExistsError(key);
    const dest = this.pathFor(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.assembling`;
    const out = createWriteStream(tmp);
    for (const p of ordered) {
      await pipeline(createReadStream(path.join(dir, `part-${String(p.partNumber).padStart(5, "0")}`)), out, { end: false });
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    await rename(tmp, dest);
    await chmod(dest, 0o444);
    await rm(dir, { recursive: true, force: true });
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  cacheDir: string;
  defaultExpiresInSec?: number;
}

/** Lazily loads the AWS SDK so local-only deployments do not pay for it. */
export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;
  private clientPromise: Promise<{ client: import("@aws-sdk/client-s3").S3Client; mod: typeof import("@aws-sdk/client-s3"); presign: typeof import("@aws-sdk/s3-request-presigner") }> | null = null;
  constructor(private readonly opts: S3StorageOptions) {}

  private async sdk() {
    this.clientPromise ??= (async () => {
      const mod = await import("@aws-sdk/client-s3");
      const presign = await import("@aws-sdk/s3-request-presigner");
      const client = new mod.S3Client({ region: this.opts.region, endpoint: this.opts.endpoint, forcePathStyle: this.opts.forcePathStyle ?? true });
      return { client, mod, presign };
    })();
    return this.clientPromise;
  }

  async putFile(key: string, sourcePath: string, opts?: { contentType?: string; immutable?: boolean }) {
    await this.putBody(key, createReadStream(sourcePath), opts, (await stat(sourcePath)).size);
  }

  async putBuffer(key: string, data: Buffer | string, opts?: { contentType?: string; immutable?: boolean }) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await this.putBody(key, buf, opts, buf.length);
  }

  private async putBody(key: string, body: Readable | Buffer, opts: { contentType?: string; immutable?: boolean } | undefined, length: number) {
    assertSafeKey(key);
    const { client, mod } = await this.sdk();
    if (opts?.immutable && (await this.exists(key))) throw new ObjectExistsError(key);
    await client.send(
      new mod.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: body,
        ContentLength: length,
        ContentType: opts?.contentType,
        ServerSideEncryption: "AES256",
        ...(opts?.immutable ? { IfNoneMatch: "*" } : {}),
      }),
    );
  }

  async getBuffer(key: string) {
    const stream = await this.openRead(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }

  async materialize(key: string) {
    assertSafeKey(key);
    const dest = path.join(this.opts.cacheDir, key);
    try {
      await stat(dest);
      return dest;
    } catch {
      await mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      await pipeline(await this.openRead(key), createWriteStream(tmp));
      await rename(tmp, dest);
      return dest;
    }
  }

  async stat(key: string): Promise<ObjectStat | null> {
    const { client, mod } = await this.sdk();
    try {
      const head = await client.send(new mod.HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return { size: Number(head.ContentLength ?? 0), modifiedAt: head.LastModified ?? new Date(0) };
    } catch {
      return null;
    }
  }

  async exists(key: string) {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string) {
    const { client, mod } = await this.sdk();
    await client.send(new mod.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async openRead(key: string, range?: { start: number; end: number }) {
    const { client, mod } = await this.sdk();
    const res = await client.send(
      new mod.GetObjectCommand({ Bucket: this.opts.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return res.Body as Readable;
  }

  async signedUrl(key: string, opts?: SignedUrlOptions) {
    const { client, mod, presign } = await this.sdk();
    return presign.getSignedUrl(
      client,
      new mod.GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        ResponseContentDisposition: opts?.downloadName ? `attachment; filename="${opts.downloadName.replace(/"/g, "")}"` : undefined,
      }),
      { expiresIn: opts?.expiresInSec ?? this.opts.defaultExpiresInSec ?? 900 },
    );
  }

  async createMultipart(key: string, contentType: string) {
    const { client, mod } = await this.sdk();
    const res = await client.send(
      new mod.CreateMultipartUploadCommand({ Bucket: this.opts.bucket, Key: key, ContentType: contentType, ServerSideEncryption: "AES256" }),
    );
    if (!res.UploadId) throw new Error("S3 não retornou UploadId");
    return res.UploadId;
  }

  async partUploadUrl(key: string, uploadId: string, partNumber: number, expiresInSec = 3600) {
    const { client, mod, presign } = await this.sdk();
    return presign.getSignedUrl(client, new mod.UploadPartCommand({ Bucket: this.opts.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), {
      expiresIn: expiresInSec,
    });
  }

  async writePart(): Promise<{ etag: string; size: number }> {
    throw new Error("S3: partes são enviadas diretamente pelo cliente via URL assinada");
  }

  async listParts(key: string, uploadId: string) {
    const { client, mod } = await this.sdk();
    const res = await client.send(new mod.ListPartsCommand({ Bucket: this.opts.bucket, Key: key, UploadId: uploadId }));
    return (res.Parts ?? []).map((p) => ({ partNumber: p.PartNumber ?? 0, size: Number(p.Size ?? 0), etag: p.ETag ?? "" }));
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    const { client, mod } = await this.sdk();
    await client.send(
      new mod.CompleteMultipartUploadCommand({
        Bucket: this.opts.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }
}

let singleton: ObjectStorage | null = null;

/** Builds the storage driver from environment variables (see .env.example). */
export function getStorage(): ObjectStorage {
  if (singleton) return singleton;
  const driver = process.env.CMF_STORAGE_DRIVER ?? "local";
  const dataDir = process.env.CMF_DATA_DIR ?? path.resolve(process.cwd(), ".data");
  if (driver === "s3") {
    const bucket = process.env.CMF_S3_BUCKET;
    if (!bucket) throw new Error("CMF_S3_BUCKET é obrigatório com CMF_STORAGE_DRIVER=s3");
    singleton = new S3ObjectStorage({
      bucket,
      region: process.env.CMF_S3_REGION ?? "us-east-1",
      endpoint: process.env.CMF_S3_ENDPOINT || undefined,
      forcePathStyle: process.env.CMF_S3_FORCE_PATH_STYLE !== "false",
      cacheDir: path.join(dataDir, "cache"),
    });
  } else {
    const secret = process.env.CMF_STORAGE_SIGNING_SECRET;
    if (!secret) throw new Error("CMF_STORAGE_SIGNING_SECRET é obrigatório");
    singleton = new LocalObjectStorage({
      rootDir: process.env.CMF_STORAGE_DIR ?? path.join(dataDir, "storage"),
      publicBaseUrl: process.env.CMF_PUBLIC_URL ?? "http://localhost:3000",
      signingSecret: secret,
    });
  }
  return singleton;
}

/** Test hook. */
export function setStorage(storage: ObjectStorage | null): void {
  singleton = storage;
}
