import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const REMOTION_ENTRY = path.join(REPO_ROOT, "packages/remotion/src/entry.ts");
export const REMOTION_PUBLIC = path.join(REPO_ROOT, "packages/remotion/public");
export const FONTS_DIR = path.join(REMOTION_PUBLIC, "fonts");

async function hashDir(dir: string, h: ReturnType<typeof createHash>) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await hashDir(p, h);
    else if (/\.(tsx?|json)$/.test(entry.name)) h.update(entry.name).update(await readFile(p));
  }
}

let bundlePromise: Promise<string> | null = null;

/**
 * Bundles the Remotion project once per source revision (content hash) and caches it on disk.
 * Bundling is the slow part (webpack); renders reuse the serve URL.
 */
export function getBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const h = createHash("sha256");
    for (const pkg of ["remotion", "schemas", "brand-engine"]) await hashDir(path.join(REPO_ROOT, "packages", pkg, "src"), h);
    const dataDir = process.env.CMF_DATA_DIR ? path.resolve(process.env.CMF_DATA_DIR) : path.join(REPO_ROOT, ".data");
    const outDir = path.join(dataDir, "remotion-bundles", h.digest("hex").slice(0, 16));
    if (existsSync(path.join(outDir, "index.html"))) return outDir;
    await mkdir(path.dirname(outDir), { recursive: true });
    const { bundle } = await import("@remotion/bundler");
    return bundle({ entryPoint: REMOTION_ENTRY, publicDir: REMOTION_PUBLIC, outDir, enableCaching: true });
  })();
  bundlePromise.catch(() => {
    bundlePromise = null;
  });
  return bundlePromise;
}
