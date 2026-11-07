"use client";
import { frameToMs, type EditPlan, type VideoItem } from "@cmf/schemas";
import { Button, Field, Input, Textarea } from "../ui";
import type { Selection } from "./timeline";

function update(plan: EditPlan, sel: Selection, patch: (item: Record<string, unknown>) => void): EditPlan {
  const next = structuredClone(plan);
  const t = next.tracks.find((x) => x.id === sel.trackId);
  const item = t?.items.find((i) => i.id === sel.itemId) as Record<string, unknown> | undefined;
  if (item) patch(item);
  return next;
}

/** Ripple-delete a video clip (and shrink the composition) — no JSON editing needed. */
function removeClip(plan: EditPlan, sel: Selection): EditPlan {
  const next = structuredClone(plan);
  const t = next.tracks.find((x) => x.id === sel.trackId);
  if (!t || t.type !== "video") return plan;
  const idx = t.items.findIndex((i) => i.id === sel.itemId);
  const clip = t.items[idx];
  if (!clip) return plan;
  const len = clip.durationInFrames;
  t.items.splice(idx, 1);
  for (const i of t.items) if (i.fromFrame > clip.fromFrame) i.fromFrame -= len;
  next.composition.durationInFrames = Math.max(1, next.composition.durationInFrames - len);
  // Dependent tracks: shift items after the clip, trim items crossing the end.
  for (const tr of next.tracks) {
    if (tr.type === "video") continue;
    tr.items = (tr.items as { fromFrame: number; durationInFrames: number }[])
      .filter((i) => !(i.fromFrame >= clip.fromFrame && i.fromFrame + i.durationInFrames <= clip.fromFrame + len))
      .map((i) => {
        const out = { ...i };
        if (out.fromFrame >= clip.fromFrame + len) out.fromFrame -= len;
        else if (out.fromFrame + out.durationInFrames > clip.fromFrame && out.fromFrame < clip.fromFrame) out.durationInFrames = Math.max(1, Math.min(out.durationInFrames, next.composition.durationInFrames - out.fromFrame));
        out.durationInFrames = Math.max(1, Math.min(out.durationInFrames, next.composition.durationInFrames - out.fromFrame));
        if ("words" in out && Array.isArray((out as { words?: unknown[] }).words)) {
          const w = out as unknown as { words: { startFrame: number; endFrame: number }[]; fromFrame: number; durationInFrames: number };
          const shift = i.fromFrame - out.fromFrame;
          w.words = w.words.map((x) => ({ ...x, startFrame: Math.max(out.fromFrame, x.startFrame - shift), endFrame: Math.min(out.fromFrame + out.durationInFrames, x.endFrame - shift) }));
        }
        return out;
      }) as typeof tr.items;
    if (tr.type === "audio")
      for (const a of tr.items) {
        a.durationInFrames = Math.min(a.durationInFrames, next.composition.durationInFrames - a.fromFrame);
        if (a.ducking) a.ducking.ranges = a.ducking.ranges.map(([s, e]) => [s >= clip.fromFrame + len ? s - len : s, e >= clip.fromFrame + len ? e - len : Math.min(e, clip.fromFrame)] as [number, number]).filter(([s, e]) => e > s);
      }
  }
  return next;
}

export function Properties({ plan, selection, onChange, editable }: { plan: EditPlan; selection: Selection | null; onChange: (p: EditPlan) => void; editable: boolean }) {
  if (!selection) return <p className="text-sm text-ink-400">Selecione um item na timeline para editar suas propriedades.</p>;
  const track = plan.tracks.find((t) => t.id === selection.trackId);
  const item = track?.items.find((i) => i.id === selection.itemId);
  if (!track || !item) return null;
  const fps = plan.composition.fps;
  const set = (patch: (i: Record<string, unknown>) => void) => onChange(update(plan, selection, patch));
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-3 text-sm">
      <div className="text-xs text-ink-400">
        {track.type} · {item.id} · início {(frameToMs(item.fromFrame, fps) / 1000).toFixed(2)}s · {(frameToMs(item.durationInFrames, fps) / 1000).toFixed(2)}s
      </div>
      {track.type === "video" && (() => {
        const v = item as VideoItem;
        return (
          <>
            <Field label={`Enquadramento horizontal (${Math.round(v.focus.x * 100)}%)`} hint="reframing do sujeito no 9:16">
              <input type="range" min={0} max={1} step={0.01} value={v.focus.x} onChange={(e) => set((i) => ((i.focus as { x: number }).x = Number(e.target.value)))} />
            </Field>
            <Field label={`Enquadramento vertical (${Math.round(v.focus.y * 100)}%)`}>
              <input type="range" min={0} max={1} step={0.01} value={v.focus.y} onChange={(e) => set((i) => ((i.focus as { y: number }).y = Number(e.target.value)))} />
            </Field>
            <Field label={`Zoom (${v.transform.scale.toFixed(2)}×)`}>
              <input type="range" min={1} max={1.6} step={0.01} value={v.transform.scale} onChange={(e) => set((i) => ((i.transform as { scale: number }).scale = Number(e.target.value)))} />
            </Field>
            <Field label={`Volume da fala (${v.volume.toFixed(2)})`} hint="faixa segura 0–2">
              <input type="range" min={0} max={2} step={0.05} value={v.volume} onChange={(e) => set((i) => (i.volume = Number(e.target.value)))} />
            </Field>
            <div className="text-xs text-ink-400">Origem {(v.sourceStartMs / 1000).toFixed(2)}–{(v.sourceEndMs / 1000).toFixed(2)}s · {v.label}</div>
            <Button variant="danger" size="sm" onClick={() => onChange(removeClip(plan, selection))}>Remover clipe (ripple)</Button>
          </>
        );
      })()}
      {track.type === "captions" && "lines" in item && (
        <>
          {item.lines.map((line, li) => (
            <Field key={li} label={`Linha ${li + 1} (${line.length} caracteres)`}>
              <Input
                value={line}
                onChange={(e) =>
                  set((i) => {
                    const lines = [...(i.lines as string[])];
                    lines[li] = e.target.value;
                    i.lines = lines;
                    // Keep words aligned with the edited text (same timing, new tokens).
                    const words = i.words as { text: string; startFrame: number; endFrame: number; highlight: boolean }[];
                    const tokens = lines.join(" ").split(/\s+/).filter(Boolean);
                    if (tokens.length === words.length) i.words = words.map((w, k) => ({ ...w, text: tokens[k]! }));
                  })
                }
              />
            </Field>
          ))}
          <div className="flex flex-wrap gap-1">
            {item.words.map((w, wi) => (
              <button key={wi} type="button" onClick={() => set((i) => ((i.words as { highlight: boolean }[])[wi]!.highlight = !w.highlight))} className={w.highlight ? "rounded bg-haxis-500 px-1.5 text-xs text-white" : "rounded bg-ink-700 px-1.5 text-xs"}>
                {w.text}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-400">Clique numa palavra para alternar o destaque semântico.</p>
        </>
      )}
      {track.type === "motion" && "kind" in item && (
        <>
          {"text" in item && (
            <Field label="Texto">
              <Textarea value={item.text} onChange={(e) => set((i) => (i.text = e.target.value))} />
            </Field>
          )}
          {item.kind === "cta" && (
            <>
              <Field label="Chamada"><Input value={item.headline} onChange={(e) => set((i) => (i.headline = e.target.value))} /></Field>
              <Field label="Subtítulo"><Input value={item.subline} onChange={(e) => set((i) => (i.subline = e.target.value))} /></Field>
            </>
          )}
          {item.kind === "lower_third" && (
            <>
              <Field label="Nome"><Input value={item.name} onChange={(e) => set((i) => (i.name = e.target.value))} /></Field>
              <Field label="Cargo"><Input value={item.role} onChange={(e) => set((i) => (i.role = e.target.value))} /></Field>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Início (frame)"><Input type="number" value={item.fromFrame} onChange={(e) => set((i) => (i.fromFrame = Math.max(0, num(e.target.value, item.fromFrame))))} /></Field>
            <Field label="Duração (frames)"><Input type="number" value={item.durationInFrames} onChange={(e) => set((i) => (i.durationInFrames = Math.max(1, num(e.target.value, item.durationInFrames))))} /></Field>
          </div>
          <Button variant="danger" size="sm" onClick={() => onChange((() => { const n = structuredClone(plan); const t = n.tracks.find((x) => x.id === selection.trackId)!; t.items = t.items.filter((x) => x.id !== selection.itemId) as typeof t.items; return n; })())}>
            Remover elemento
          </Button>
        </>
      )}
      {track.type === "audio" && "volume" in item && "kind" in item && (
        <>
          <Field label={`Volume da trilha (${item.volume.toFixed(2)})`}>
            <input type="range" min={0} max={1} step={0.01} value={item.volume} onChange={(e) => set((i) => (i.volume = Number(e.target.value)))} />
          </Field>
          {item.ducking && (
            <Field label={`Volume sob a fala (${item.ducking.duckedVolume.toFixed(2)})`}>
              <input type="range" min={0} max={1} step={0.01} value={item.ducking.duckedVolume} onChange={(e) => set((i) => ((i.ducking as { duckedVolume: number }).duckedVolume = Number(e.target.value)))} />
            </Field>
          )}
          <div className="text-xs text-ink-400">Origem: {item.origin}</div>
        </>
      )}
    </fieldset>
  );
}
