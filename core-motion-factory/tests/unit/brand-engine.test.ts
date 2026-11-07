import { describe, expect, it } from "vitest";
import { clampToSafe, contrastRatio, logoBox, missingFontFamilies, BUNDLED_FONTS, readableOn, safeAreaFor } from "@cmf/brand-engine";
import { BrandTokensSchema, DEFAULT_BRAND_TOKENS } from "@cmf/schemas";

describe("brand engine: safe areas, contrast, fonts", () => {
  it("clamps boxes inside the platform safe area", () => {
    const safe = safeAreaFor(1080, 1920);
    const b = clampToSafe({ x: 0, y: 0, w: 100, h: 100 }, safe);
    expect(b.x).toBeGreaterThanOrEqual(safe.side);
    expect(b.y).toBeGreaterThanOrEqual(safe.top);
    expect(b.x + b.w).toBeLessThanOrEqual(100 - safe.side + 0.01);
    expect(b.y + b.h).toBeLessThanOrEqual(100 - safe.bottom + 0.01);
  });
  it("places the logo inside the safe area with the minimum width", () => {
    for (const [w, h] of [[1080, 1920], [1080, 1080], [1920, 1080]] as const) {
      const box = logoBox(DEFAULT_BRAND_TOKENS, w, h);
      const safe = safeAreaFor(w, h);
      expect(box.w).toBeGreaterThanOrEqual(DEFAULT_BRAND_TOKENS.logo.minWidthPercent);
      expect(box.x + box.w).toBeLessThanOrEqual(100 - safe.side + 0.01);
      expect(box.y).toBeGreaterThanOrEqual(safe.top - 0.01);
    }
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
    expect(readableOn("#FF5A1F")).toBe("#111111");
    expect(readableOn("#111111")).toBe("#FFFFFF");
  });
  it("reports brand font families without files", () => {
    expect(missingFontFamilies(DEFAULT_BRAND_TOKENS, BUNDLED_FONTS)).toEqual([]);
    const t = BrandTokensSchema.parse({ ...DEFAULT_BRAND_TOKENS, typography: { ...DEFAULT_BRAND_TOKENS.typography, heading: "Marca Sans" } });
    expect(missingFontFamilies(t, BUNDLED_FONTS)).toEqual(["Marca Sans"]);
  });
});
