/**
 * Section 24 — visual tests: reference frames of the premium template in 9:16, 1:1 and 16:9,
 * compared with a tolerance; a missing font must fail the render explicitly.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { renderFrame } from "@cmf/renderer";
import { sampleEditPlan } from "@cmf/remotion";
import { BrandTokensSchema, DEFAULT_BRAND_TOKENS } from "@cmf/schemas";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REF = path.join(ROOT, "tests/visual/__references__");
const OUT = path.join(ROOT, "tests/visual/__output__");
const UPDATE = process.env.CMF_UPDATE_SNAPSHOTS === "1";
/** Max fraction of differing pixels (anti-aliasing / encoder noise tolerance). */
const TOLERANCE = 0.01;

const CASES = [
  { aspect: "9x16", w: 1080, h: 1920 },
  { aspect: "1x1", w: 1080, h: 1080 },
  { aspect: "16x9", w: 1920, h: 1080 },
] as const;
const FRAMES = [{ name: "hook", frame: 40 }, { name: "body", frame: 200 }, { name: "cta", frame: 280 }];

async function compare(name: string, file: string) {
  const ref = path.join(REF, `${name}.png`);
  if (UPDATE || !existsSync(ref)) {
    if (!UPDATE) throw new Error(`referência ausente: ${name} — rode npm run test:visual:update`);
    await writeFile(ref, await readFile(file));
    return 0;
  }
  const a = PNG.sync.read(await readFile(ref));
  const b = PNG.sync.read(await readFile(file));
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.15 });
  const ratio = n / (a.width * a.height);
  if (ratio > TOLERANCE) await writeFile(path.join(OUT, `${name}.diff.png`), PNG.sync.write(diff));
  return ratio;
}

describe.sequential("template Autoridade Premium — frames de referência", () => {
  for (const c of CASES) {
    for (const f of FRAMES) {
      it(`${c.aspect} @ ${f.name}`, async () => {
        await mkdir(OUT, { recursive: true });
        await mkdir(REF, { recursive: true });
        const file = path.join(OUT, `${c.aspect}-${f.name}.png`);
        await renderFrame({ plan: sampleEditPlan(c.w, c.h), brand: { name: "HAXIS Core", tokens: DEFAULT_BRAND_TOKENS }, media: {}, output: file, frame: f.frame, scale: 0.5 });
        expect(await compare(`${c.aspect}-${f.name}`, file)).toBeLessThanOrEqual(TOLERANCE);
      });
    }
  }

  it("fonte ausente falha explicitamente (sem fallback silencioso)", async () => {
    const tokens = BrandTokensSchema.parse({ ...DEFAULT_BRAND_TOKENS, typography: { ...DEFAULT_BRAND_TOKENS.typography, heading: "Fonte Inexistente" } });
    await expect(renderFrame({ plan: sampleEditPlan(), brand: { name: "X", tokens }, media: {}, output: path.join(OUT, "missing-font.png"), frame: 10, scale: 0.25 })).rejects.toThrow(/FONT_MISSING/);
  });
});
