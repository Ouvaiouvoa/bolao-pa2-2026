import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { findTrack, type AudioItem, type VideoItem } from "@cmf/schemas";
import { CaptionPage, Callout, CtaCard, Footer, HookTitle, Logo, LowerThird, ProgressBar } from "./components/elements";
import { useBrandFonts } from "./fonts";
import type { CompositionProps, RenderMediaRef } from "./types";

function VideoClip({ item, media }: { item: VideoItem; media: RenderMediaRef | undefined }) {
  const { fps } = useVideoConfig();
  if (!media) return <AbsoluteFill style={{ background: "#300", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 40 }}>MÍDIA OFFLINE: {item.assetId}</AbsoluteFill>;
  const t = item.transform;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={media.src}
        trimBefore={Math.round((item.sourceStartMs * fps) / 1000)}
        volume={item.volume}
        style={{
          width: "100%",
          height: "100%",
          objectFit: item.fit,
          objectPosition: `${item.focus.x * 100}% ${item.focus.y * 100}%`,
          transform: `translate(${t.x}%, ${t.y}%) scale(${t.scale}) rotate(${t.rotation}deg)`,
          transformOrigin: `${item.focus.x * 100}% ${item.focus.y * 100}%`,
        }}
      />
    </AbsoluteFill>
  );
}

/** Ducking envelope: smooth attack/release around speech ranges, plus fades. Frame is relative to the item. */
export function musicVolumeAt(item: AudioItem, frame: number): number {
  const abs = frame + item.fromFrame;
  let v = item.volume;
  const d = item.ducking;
  if (d?.enabled) {
    let duck = 0;
    for (const [s, e] of d.ranges) {
      if (abs < s - d.attackFrames || abs > e + d.releaseFrames) continue;
      const k = abs < s ? (abs - (s - d.attackFrames)) / Math.max(1, d.attackFrames) : abs > e ? 1 - (abs - e) / Math.max(1, d.releaseFrames) : 1;
      duck = Math.max(duck, Math.min(1, Math.max(0, k)));
    }
    v = item.volume + (d.duckedVolume - item.volume) * duck;
  }
  const fadeIn = item.fadeInFrames ? interpolate(frame, [0, item.fadeInFrames], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const fadeOut = item.fadeOutFrames ? interpolate(frame, [item.durationInFrames - item.fadeOutFrames, item.durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return Math.max(0, v * fadeIn * fadeOut);
}

export const EditPlanComposition: React.FC<CompositionProps> = ({ plan, brand, media, fonts }) => {
  const tokens = brand.tokens;
  const ready = useBrandFonts(fonts, [tokens.typography.heading, tokens.typography.body]);
  const video = findTrack(plan, "video");
  const captions = findTrack(plan, "captions");
  const motion = findTrack(plan, "motion");
  const audio = findTrack(plan, "audio");
  const logoItem = motion?.items.find((m) => m.kind === "logo");
  const logoSrc = logoItem && logoItem.kind === "logo" ? (media[logoItem.assetId]?.src ?? null) : null;
  return (
    <AbsoluteFill style={{ backgroundColor: plan.composition.backgroundColor }}>
      {!video?.muted &&
        video?.items.map((item) => (
          <Sequence key={item.id} from={item.fromFrame} durationInFrames={item.durationInFrames} name={item.label ?? item.id}>
            <VideoClip item={item} media={media[item.assetId]} />
          </Sequence>
        ))}
      {/* Legibility scrim for top titles and bottom captions. */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%)" }} />
      {ready &&
        !motion?.muted &&
        motion?.items
          .filter((m) => m.kind !== "cta" && m.kind !== "footer")
          .map((m) => (
            <Sequence key={m.id} from={m.fromFrame} durationInFrames={m.durationInFrames} name={`${m.kind}:${m.id}`}>
              {m.kind === "hook_title" ? <HookTitle item={m} tokens={tokens} /> : null}
              {m.kind === "lower_third" ? <LowerThird item={m} tokens={tokens} /> : null}
              {m.kind === "callout" ? <Callout item={m} tokens={tokens} /> : null}
              {m.kind === "progress_bar" ? <ProgressBar item={m} tokens={tokens} /> : null}
              {m.kind === "logo" ? <Logo item={m} src={logoSrc} /> : null}
            </Sequence>
          ))}
      {ready &&
        !captions?.muted &&
        captions?.items.map((c) => (
          <Sequence key={c.id} from={c.fromFrame} durationInFrames={c.durationInFrames} name={`legenda:${c.id}`}>
            <CaptionPage item={c} tokens={tokens} />
          </Sequence>
        ))}
      {ready &&
        motion?.items
          .filter((m) => m.kind === "cta" || m.kind === "footer")
          .map((m) => (
            <Sequence key={m.id} from={m.fromFrame} durationInFrames={m.durationInFrames} name={`${m.kind}:${m.id}`}>
              {m.kind === "cta" ? <CtaCard item={m} tokens={tokens} logoSrc={logoSrc} brandName={brand.name} /> : null}
              {m.kind === "footer" ? <Footer item={m} tokens={tokens} /> : null}
            </Sequence>
          ))}
      {!audio?.muted &&
        audio?.items.map((a) =>
          media[a.assetId] ? (
            <Sequence key={a.id} from={a.fromFrame} durationInFrames={a.durationInFrames} name={`audio:${a.kind}`}>
              <Audio src={media[a.assetId]!.src} loop={a.loop} volume={(f) => musicVolumeAt(a, f)} />
            </Sequence>
          ) : null,
        )}
    </AbsoluteFill>
  );
};
