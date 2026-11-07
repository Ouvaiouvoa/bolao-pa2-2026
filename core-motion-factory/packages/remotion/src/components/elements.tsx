import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { motionProfile, readableOn } from "@cmf/brand-engine";
import { resolveColor, type BrandTokens, type Box, type CaptionItem, type MotionItem } from "@cmf/schemas";

type Tokens = BrandTokens;

export const boxStyle = (b: Box): CSSProperties => ({
  position: "absolute",
  left: `${b.x}%`,
  top: `${b.y}%`,
  width: `${b.w}%`,
  height: `${b.h}%`,
});

/** Font size in px relative to the composition's short side (keeps layouts aspect-agnostic). */
export function useUnit(): (v: number) => number {
  const { width, height } = useVideoConfig();
  const short = Math.min(width, height);
  return (v: number) => (v * short) / 1080;
}

function useEnter(durationInFrames: number, tokens: Tokens, delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = motionProfile(tokens.motion.style);
  const enter = spring({ frame: frame - delay, fps, config: { damping: p.springDamping, stiffness: p.springStiffness } });
  const exitStart = durationInFrames - Math.max(4, tokens.motion.transitionFrames);
  const exit = interpolate(frame, [exitStart, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { enter, exit, frame, fps, profile: p };
}

export function HookTitle({ item, tokens }: { item: Extract<MotionItem, { kind: "hook_title" }>; tokens: Tokens }) {
  const u = useUnit();
  const { exit, frame, fps, profile } = useEnter(item.durationInFrames, tokens);
  const words = item.text.split(/\s+/);
  const accent = resolveColor(item.accentColor, tokens);
  const color = resolveColor(item.color, tokens);
  const emphasis = new Set(item.emphasis.map((e) => e.toLowerCase().replace(/[.,!?…]/g, "")));
  const font = item.fontFamily ?? tokens.typography.heading;
  return (
    <div style={{ ...boxStyle(item.box), display: "flex", alignItems: "flex-start", justifyContent: "center", flexDirection: "column", opacity: exit }}>
      <div style={{ fontFamily: font, fontWeight: 900, fontSize: u(78), lineHeight: 1.04, letterSpacing: "-0.02em", color, textShadow: `0 ${u(6)}px ${u(28)}px rgba(0,0,0,0.55)` }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * profile.stagger, fps, config: { damping: profile.springDamping, stiffness: profile.springStiffness } });
          const isEm = emphasis.has(w.toLowerCase().replace(/[.,!?…]/g, ""));
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.22em",
                transform: `translateY(${interpolate(s, [0, 1], [u(40), 0])}px)`,
                opacity: s,
                color: isEm ? accent : color,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: u(18), height: u(10), width: `${interpolate(spring({ frame: frame - words.length * profile.stagger, fps }), [0, 1], [0, 34])}%`, background: accent, borderRadius: u(6) }} />
    </div>
  );
}

export function LowerThird({ item, tokens }: { item: Extract<MotionItem, { kind: "lower_third" }>; tokens: Tokens }) {
  const u = useUnit();
  const { enter, exit } = useEnter(item.durationInFrames, tokens);
  const bg = resolveColor(item.color, tokens);
  const accent = resolveColor(item.accentColor, tokens);
  const fg = readableOn(bg);
  return (
    <div style={{ ...boxStyle(item.box), opacity: exit, transform: `translateX(${interpolate(enter, [0, 1], [-u(120), 0])}px)` }}>
      <div style={{ display: "inline-flex", alignItems: "stretch", height: "100%", borderRadius: u(14), overflow: "hidden", boxShadow: `0 ${u(10)}px ${u(30)}px rgba(0,0,0,0.35)` }}>
        <div style={{ width: u(12), background: accent }} />
        <div style={{ background: bg, padding: `${u(10)}px ${u(26)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: item.fontFamily ?? tokens.typography.heading, fontWeight: 800, fontSize: u(40), color: fg, whiteSpace: "nowrap" }}>{item.name}</div>
          {item.role ? <div style={{ fontFamily: tokens.typography.body, fontWeight: 600, fontSize: u(26), color: fg, opacity: 0.78, whiteSpace: "nowrap" }}>{item.role}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function Callout({ item, tokens }: { item: Extract<MotionItem, { kind: "callout" }>; tokens: Tokens }) {
  const u = useUnit();
  const { enter, exit } = useEnter(item.durationInFrames, tokens);
  const bg = resolveColor(item.color, tokens);
  return (
    <div style={{ ...boxStyle(item.box), display: "flex", alignItems: "center", justifyContent: "flex-start", opacity: exit }}>
      <div
        style={{
          transform: `scale(${interpolate(enter, [0, 1], [0.6, 1])})`,
          transformOrigin: "left center",
          opacity: enter,
          background: bg,
          color: readableOn(bg),
          fontFamily: item.fontFamily ?? tokens.typography.heading,
          fontWeight: 800,
          fontSize: u(42),
          padding: `${u(12)}px ${u(28)}px`,
          borderRadius: u(999),
          boxShadow: `0 ${u(10)}px ${u(30)}px rgba(0,0,0,0.35)`,
          whiteSpace: "nowrap",
        }}
      >
        {item.text}
      </div>
    </div>
  );
}

export function CtaCard({ item, tokens, logoSrc, brandName }: { item: Extract<MotionItem, { kind: "cta" }>; tokens: Tokens; logoSrc: string | null; brandName: string }) {
  const u = useUnit();
  const { enter, frame, fps } = useEnter(item.durationInFrames + 1000, tokens);
  const accent = resolveColor(item.color, tokens);
  const primary = tokens.colors.primary;
  const bgIn = interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp" });
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${primary}E6 0%, ${primary}F2 55%, #000000F2 100%)`, opacity: bgIn }} />
      <div style={{ ...boxStyle(item.box), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: u(28), textAlign: "center" }}>
        {item.showLogo && logoSrc ? <Img src={logoSrc} style={{ width: "42%", maxHeight: "22%", objectFit: "contain", opacity: enter }} /> : null}
        <div style={{ fontFamily: item.fontFamily ?? tokens.typography.heading, fontWeight: 900, fontSize: u(72), lineHeight: 1.05, color: readableOn(primary), transform: `translateY(${interpolate(enter, [0, 1], [u(40), 0])}px)`, opacity: enter }}>
          {item.headline}
        </div>
        <div
          style={{
            background: accent,
            color: readableOn(accent),
            fontFamily: tokens.typography.heading,
            fontWeight: 800,
            fontSize: u(40),
            padding: `${u(18)}px ${u(44)}px`,
            borderRadius: u(999),
            transform: `scale(${enter * pulse})`,
            boxShadow: `0 ${u(14)}px ${u(40)}px ${accent}66`,
          }}
        >
          {item.subline || brandName}
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function ProgressBar({ item, tokens }: { item: Extract<MotionItem, { kind: "progress_bar" }>; tokens: Tokens }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const color = resolveColor(item.color, tokens);
  const progress = Math.min(1, frame / Math.max(1, item.durationInFrames - 1));
  return (
    <div style={{ ...boxStyle(item.box), height: Math.max(u(6), 4), background: "rgba(255,255,255,0.22)", borderRadius: u(6), overflow: "hidden" }}>
      <div style={{ width: `${progress * 100}%`, height: "100%", background: color, borderRadius: u(6) }} />
    </div>
  );
}

export function Logo({ item, src }: { item: Extract<MotionItem, { kind: "logo" }>; src: string | null }) {
  if (!src) return null;
  return <Img src={src} style={{ ...boxStyle(item.box), objectFit: "contain", objectPosition: "right top", opacity: item.opacity }} />;
}

export function Footer({ item, tokens }: { item: Extract<MotionItem, { kind: "footer" }>; tokens: Tokens }) {
  const u = useUnit();
  return (
    <div style={{ ...boxStyle(item.box), display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: item.fontFamily ?? tokens.typography.body, fontWeight: 600, fontSize: u(22), letterSpacing: "0.08em", color: resolveColor(item.color, tokens), opacity: 0.72, textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}>
        {item.text}
      </div>
    </div>
  );
}

/** Caption page renderer: bold-pop / clean / karaoke presets. Frame-accurate word timing. */
export function CaptionPage({ item, tokens }: { item: CaptionItem; tokens: Tokens }): ReactNode {
  const frame = useCurrentFrame(); // relative to the item's Sequence
  const { fps } = useVideoConfig();
  const u = useUnit();
  const abs = frame + item.fromFrame;
  const color = resolveColor(item.color, tokens);
  const hl = resolveColor(item.highlightColor, tokens);
  const font = item.fontFamily ?? tokens.typography.heading;
  const appear = spring({ frame, fps, config: { damping: 16, stiffness: 160 } });
  const preset = item.preset;
  // Auto-fit: the longest line must fit the safe width (uppercase bold glyphs are wide).
  const longest = Math.max(8, ...item.lines.map((l) => l.length));
  const baseSize = preset === "clean" ? 50 : 60;
  const fitSize = Math.min(baseSize, (preset === "bold-pop" ? 1300 : 1500) / longest);
  // Distribute words over the stored lines.
  let cursor = 0;
  const lines = item.lines.map((line) => {
    const count = line.split(/\s+/).length;
    const words = item.words.slice(cursor, cursor + count);
    cursor += count;
    return words;
  });
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", bottom: `${item.bottomPercent}%`, display: "flex", flexDirection: "column", alignItems: "center", gap: u(6), transform: `scale(${interpolate(appear, [0, 1], [0.92, 1])})`, opacity: appear }}>
      {lines.map((words, li) => (
        <div
          key={li}
          style={{
            fontFamily: font,
            fontWeight: preset === "clean" ? 700 : tokens.typography.captionWeight,
            fontSize: u(fitSize),
            whiteSpace: "nowrap",
            lineHeight: 1.12,
            textAlign: "center",
            textTransform: preset === "bold-pop" ? "uppercase" : "none",
            color,
            background: preset === "clean" ? "rgba(0,0,0,0.55)" : "transparent",
            padding: preset === "clean" ? `${u(4)}px ${u(16)}px` : 0,
            borderRadius: u(10),
            WebkitTextStroke: preset === "clean" ? undefined : `${u(6)}px rgba(0,0,0,0.9)`,
            paintOrder: "stroke fill",
            textShadow: `0 ${u(4)}px ${u(14)}px rgba(0,0,0,0.6)`,
          }}
        >
          {words.map((w, wi) => {
            const active = abs >= w.startFrame && abs < Math.max(w.endFrame, w.startFrame + 2);
            const spoken = abs >= w.startFrame;
            const isHl = w.highlight;
            const wordColor = isHl ? hl : preset === "karaoke" ? (spoken ? hl : color) : color;
            const scale = preset === "bold-pop" && active ? 1.06 : 1;
            return (
              <span key={wi} style={{ display: "inline-block", margin: "0 0.17em", color: wordColor, transform: `scale(${scale})`, opacity: preset === "karaoke" || spoken || preset === "clean" ? 1 : 0.92 }}>
                {w.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
