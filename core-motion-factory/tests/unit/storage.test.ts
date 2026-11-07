import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createUrlSigner, LocalObjectStorage, ObjectExistsError, organizationOfKey } from "@cmf/storage";

describe("storage: signed URLs, multipart, immutability", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cmf-st-"));
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const s = new LocalObjectStorage({ rootDir: dir, publicBaseUrl: "http://x", signingSecret: "0123456789abcdef0123" });

  it("signs and verifies short-lived URLs (expiry and tampering)", () => {
    const signer = createUrlSigner("0123456789abcdef0123");
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signer.sign("org/a/x.mp4", exp);
    expect(signer.verify("org/a/x.mp4", exp, sig)).toBe(true);
    expect(signer.verify("org/b/x.mp4", exp, sig)).toBe(false);
    expect(signer.verify("org/a/x.mp4", exp - 120, sig)).toBe(false);
    expect(signer.verify("org/a/x.mp4", Math.floor(Date.now() / 1000) - 1, signer.sign("org/a/x.mp4", Math.floor(Date.now() / 1000) - 1))).toBe(false);
  });
  it("assembles a resumable multipart upload in order and refuses overwrite", async () => {
    const key = "org/a/projects/p/assets/x/original.bin";
    const up = await s.createMultipart(key, "application/octet-stream");
    await s.writePart(up, 2, Buffer.from("world"));
    expect((await s.listParts(key, up)).map((p) => p.partNumber)).toEqual([2]);
    await s.writePart(up, 1, Buffer.from("hello "));
    const parts = await s.listParts(key, up);
    await s.completeMultipart(key, up, parts);
    expect(await readFile(s.pathFor(key), "utf8")).toBe("hello world");
    await expect(s.putBuffer(key, "x", { immutable: true })).rejects.toBeInstanceOf(ObjectExistsError);
  });
  it("rejects path traversal and extracts the tenant", () => {
    expect(() => s.pathFor("../etc/passwd")).toThrow();
    expect(() => s.pathFor("/abs")).toThrow();
    expect(organizationOfKey("org/org_1/projects/p/x")).toBe("org_1");
    expect(organizationOfKey("brands/x")).toBeNull();
  });
});
