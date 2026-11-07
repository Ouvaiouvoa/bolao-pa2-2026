"use client";
import { Player, type PlayerRef } from "@remotion/player";
import { forwardRef, useMemo } from "react";
import { BUNDLED_FONTS } from "@cmf/brand-engine";
import { EditPlanComposition } from "@cmf/remotion/composition";
import type { BrandTokens, EditPlan } from "@cmf/schemas";

export const FONT_URLS = BUNDLED_FONTS.map((f) => ({ family: f.family, weight: f.weight, style: f.style, url: `/fonts/${f.src}` }));

/** Browser preview of the exact same Remotion composition used by the renderer. */
export const PlanPlayer = forwardRef<PlayerRef, { plan: EditPlan; brand: { name: string; tokens: BrandTokens }; media: Record<string, { src: string; kind: "video" | "audio" | "image" }> }>(function PlanPlayer({ plan, brand, media }, ref) {
  const inputProps = useMemo(() => ({ plan, brand, media, fonts: FONT_URLS }), [plan, brand, media]);
  const { width, height, fps, durationInFrames } = plan.composition;
  return (
    <Player
      ref={ref}
      component={EditPlanComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={fps}
      controls
      acknowledgeRemotionLicense
      style={{ width: "100%", maxHeight: "62vh", aspectRatio: `${width} / ${height}`, background: "#000", borderRadius: 12 }}
      clickToPlay
      spaceKeyToPlayOrPause
    />
  );
});
