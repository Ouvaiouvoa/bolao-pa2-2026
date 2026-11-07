import { DEFAULT_BRAND_TOKENS, type AssetRef, type EditPlan } from "@cmf/schemas";

export const ORG = "org_a";
export const assets = (extra: [string, Partial<AssetRef>][] = []) =>
  new Map<string, AssetRef>([
    ["ast_v1", { id: "ast_v1", organizationId: ORG, kind: "video", durationMs: 40_000 }],
    ["ast_music", { id: "ast_music", organizationId: ORG, kind: "music", durationMs: 60_000 }],
    ["ast_foreign", { id: "ast_foreign", organizationId: "org_b", kind: "video", durationMs: 40_000 }],
    ...extra.map(([id, a]) => [id, { id, organizationId: ORG, kind: "video", durationMs: 10_000, ...a }] as [string, AssetRef]),
  ]);

export function validPlan(): EditPlan {
  return {
    schemaVersion: "1.0",
    projectId: "prj_1",
    composition: { width: 1080, height: 1920, fps: 30, durationInFrames: 300, backgroundColor: "#111111" },
    tracks: [
      {
        id: "video-main",
        type: "video",
        locked: false,
        muted: false,
        items: [
          { id: "clip-001", assetId: "ast_v1", fromFrame: 0, durationInFrames: 150, sourceStartMs: 1000, sourceEndMs: 6000, fit: "cover", focus: { x: 0.4, y: 0.5 }, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 },
          { id: "clip-002", assetId: "ast_v1", fromFrame: 150, durationInFrames: 150, sourceStartMs: 8000, sourceEndMs: 13000, fit: "cover", focus: { x: 0.4, y: 0.5 }, transform: { x: 0, y: 0, scale: 1.12, rotation: 0 }, volume: 1.2 },
        ],
      },
      {
        id: "captions-main",
        type: "captions",
        locked: false,
        muted: false,
        items: [{ id: "cap-0001", fromFrame: 10, durationInFrames: 40, lines: ["Olá mundo"], words: [{ text: "Olá", startFrame: 10, endFrame: 20, highlight: false }, { text: "mundo", startFrame: 20, endFrame: 40, highlight: true }], preset: "bold-pop", bottomPercent: 22, color: "#FFFFFF", highlightColor: "accent" }],
      },
      { id: "motion-main", type: "motion", locked: false, muted: false, items: [{ id: "mo-hook", kind: "hook_title", fromFrame: 0, durationInFrames: 80, box: { x: 8, y: 16, w: 84, h: 20 }, text: "Gancho", emphasis: [], color: "#FFFFFF", accentColor: "accent" }] },
      { id: "audio-main", type: "audio", locked: false, muted: false, items: [{ id: "music-bed", kind: "music", assetId: "ast_music", fromFrame: 0, durationInFrames: 300, sourceStartMs: 0, volume: 0.18, fadeInFrames: 15, fadeOutFrames: 30, loop: true, origin: "gerada", ducking: { enabled: true, duckedVolume: 0.06, attackFrames: 6, releaseFrames: 12, ranges: [[10, 280]] } }] },
    ],
    brandId: "brand_1",
    templateId: "tpl_authority_001",
    metadata: { createdBy: "test", createdAt: "2026-11-07T00:00:00.000Z", basedOnVersion: null, notes: "" },
  };
}

export const ctx = (over: Partial<{ assets: Map<string, AssetRef> }> = {}) => ({ organizationId: ORG, projectId: "prj_1", brandId: "brand_1", brandTokens: DEFAULT_BRAND_TOKENS, assets: over.assets ?? assets() });
