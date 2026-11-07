"use client";
import { useMemo, useRef, useState } from "react";
import { frameToTimecode, type EditPlan, type Track } from "@cmf/schemas";
import { cx } from "../ui";

export interface Selection {
  trackId: string;
  itemId: string;
}

const TRACK_STYLE: Record<Track["type"], { label: string; color: string }> = {
  video: { label: "Vídeo", color: "bg-info-500/30 border-info-500/60" },
  captions: { label: "Legendas", color: "bg-ok-500/25 border-ok-500/60" },
  motion: { label: "Motion", color: "bg-haxis-500/25 border-haxis-500/60" },
  audio: { label: "Áudio", color: "bg-warn-500/25 border-warn-500/60" },
};

function itemLabel(t: Track, item: Track["items"][number]): string {
  if (t.type === "video" && "label" in item) return item.label ?? item.id;
  if (t.type === "captions" && "lines" in item) return item.lines.join(" ");
  if ("kind" in item) {
    if ("text" in item) return `${item.kind}: ${item.text}`;
    if ("headline" in item) return `cta: ${item.headline}`;
    if ("name" in item) return `lower third: ${item.name}`;
    return String(item.kind);
  }
  return item.id;
}

/**
 * Multi-track timeline synchronized with the Player. Captions and motion items can be dragged
 * (move) or trimmed (right edge) directly; precise edits live in the properties panel.
 */
export function Timeline({
  plan,
  frame,
  onSeek,
  selection,
  onSelect,
  onChange,
  editable,
}: {
  plan: EditPlan;
  frame: number;
  onSeek: (f: number) => void;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onChange: (p: EditPlan) => void;
  editable: boolean;
}) {
  const [zoom, setZoom] = useState(3); // px per frame
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ trackId: string; itemId: string; mode: "move" | "trim"; startX: number; from: number; dur: number } | null>(null);
  const { durationInFrames, fps } = plan.composition;
  const width = durationInFrames * zoom;
  const ticks = useMemo(() => {
    const out: number[] = [];
    const step = zoom >= 4 ? fps : zoom >= 2 ? fps * 2 : fps * 5;
    for (let f = 0; f <= durationInFrames; f += step) out.push(f);
    return out;
  }, [durationInFrames, fps, zoom]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(Math.max(0, Math.min(durationInFrames - 1, Math.round((e.clientX - rect.left) / zoom))));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.startX) / zoom);
    const next = structuredClone(plan);
    const track = next.tracks.find((t) => t.id === d.trackId);
    const item = track?.items.find((i) => i.id === d.itemId);
    if (!track || !item) return;
    if (d.mode === "move") item.fromFrame = Math.max(0, Math.min(durationInFrames - item.durationInFrames, d.from + delta));
    else item.durationInFrames = Math.max(1, Math.min(durationInFrames - item.fromFrame, d.dur + delta));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span className="font-mono tabular-nums text-ink-200" data-testid="timecode">{frameToTimecode(frame, fps)}</span>
        <div className="flex items-center gap-2">
          <span>zoom</span>
          <input aria-label="Zoom da timeline" type="range" min={1} max={8} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </div>
      </div>
      <div className="flex">
        <div className="w-20 shrink-0 pt-6 text-[11px] font-semibold text-ink-400">
          {plan.tracks.map((t) => (
            <div key={t.id} className="flex h-9 items-center">{TRACK_STYLE[t.type].label}</div>
          ))}
        </div>
        <div ref={scroller} className="scrollbar-thin relative min-w-0 flex-1 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900">
          <div style={{ width }} className="relative">
            <div className="relative h-6 cursor-pointer border-b border-ink-700" onClick={seekFromEvent} data-testid="timeline-ruler">
              {ticks.map((f) => (
                <div key={f} className="absolute top-0 h-full border-l border-ink-700 pl-1 text-[10px] text-ink-500" style={{ left: f * zoom }}>
                  {Math.round(f / fps)}s
                </div>
              ))}
            </div>
            {plan.tracks.map((t) => (
              <div key={t.id} className="relative h-9 border-b border-ink-800" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
                {t.items.map((item) => {
                  const selected = selection?.itemId === item.id && selection.trackId === t.id;
                  const draggable = editable && (t.type === "captions" || t.type === "motion");
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      title={itemLabel(t, item)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect({ trackId: t.id, itemId: item.id });
                        onSeek(item.fromFrame);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && onSelect({ trackId: t.id, itemId: item.id })}
                      onPointerDown={(e) => {
                        if (!draggable) return;
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const mode = e.clientX > rect.right - 8 ? "trim" : "move";
                        drag.current = { trackId: t.id, itemId: item.id, mode, startX: e.clientX, from: item.fromFrame, dur: item.durationInFrames };
                      }}
                      className={cx(
                        "absolute top-1 bottom-1 overflow-hidden rounded-md border px-1.5 text-[10px] leading-7 whitespace-nowrap text-ink-100",
                        TRACK_STYLE[t.type].color,
                        selected && "ring-2 ring-haxis-500",
                        draggable ? "cursor-grab" : "cursor-pointer",
                      )}
                      style={{ left: item.fromFrame * zoom, width: Math.max(3, item.durationInFrames * zoom) }}
                    >
                      {itemLabel(t, item)}
                      {draggable && <span className="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-white/10" />}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-haxis-500" style={{ left: frame * zoom }} />
          </div>
        </div>
      </div>
    </div>
  );
}
