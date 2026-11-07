/**
 * npm run remotion:render:fixture
 * Validates Remotion + FFmpeg in this environment: renders the premium template over the
 * raw fixture footage (reframed 16:9 → 9:16) and checks the output with ffprobe.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { probe } from "@cmf/media";
import { sampleEditPlan } from "@cmf/remotion";
import { DEFAULT_BRAND_TOKENS, type EditPlan } from "@cmf/schemas";
import { REPO_ROOT, renderEditPlan } from "../index";

async function main() {
  const fixture = path.join(REPO_ROOT, "tests/fixtures/raw-talk-pt.mp4");
  const outDir = path.join(REPO_ROOT, ".data/fixture-render");
  await mkdir(outDir, { recursive: true });
  const plan: EditPlan = sampleEditPlan(1080, 1920);
  const video = plan.tracks.find((t) => t.type === "video");
  if (video?.type === "video") {
    video.items = [
      { id: "clip-001", assetId: "ast_fixture", fromFrame: 0, durationInFrames: 150, sourceStartMs: 2966.667, sourceEndMs: 7966.667, fit: "cover", focus: { x: 0.36, y: 0.5 }, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 },
      { id: "clip-002", assetId: "ast_fixture", fromFrame: 150, durationInFrames: 150, sourceStartMs: 13800, sourceEndMs: 18800, fit: "cover", focus: { x: 0.36, y: 0.5 }, transform: { x: 0, y: 0, scale: 1.12, rotation: 0 }, volume: 1 },
    ];
  }
  const output = path.join(outDir, "fixture-9x16.mp4");
  const started = Date.now();
  let last = -1;
  const res = await renderEditPlan({
    plan,
    brand: { name: "HAXIS Core", tokens: DEFAULT_BRAND_TOKENS },
    media: { ast_fixture: { path: fixture, kind: "video" } },
    output,
    scale: 1,
    onProgress: (f) => {
      const pct = Math.floor(f * 10) * 10;
      if (pct > last) {
        last = pct;
        console.log(`render ${pct}%`);
      }
    },
  });
  const info = await probe(output);
  console.log(`\n${output}\n${info.width}x${info.height} ${info.fps}fps ${info.videoCodec}/${info.audioCodec} ${(info.durationMs / 1000).toFixed(2)}s — ${res.framesRendered} frames em ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (info.width !== 1080 || info.height !== 1920 || info.videoCodec !== "h264" || info.audioCodec !== "aac") {
    console.error("render de fixture fora da especificação");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
