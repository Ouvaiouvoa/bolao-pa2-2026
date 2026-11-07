/**
 * Frame / timecode math. Every conversion in the product goes through these helpers so
 * that rendering, captions and review comments agree on the same frame grid.
 */

export const SUPPORTED_FPS = [24, 25, 30, 50, 60] as const;
export type Fps = (typeof SUPPORTED_FPS)[number];

/** Milliseconds → frame index (floor). Frame N covers [N/fps, (N+1)/fps). */
export function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) throw new RangeError("msToFrame: invalid input");
  // Small epsilon protects against 33.333…ms float drift (e.g. 1000/30*3 = 99.99999).
  return Math.floor((ms * fps) / 1000 + 1e-6);
}

/** Milliseconds → nearest frame boundary (used when snapping cut points). */
export function msToFrameRound(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || fps <= 0) throw new RangeError("msToFrameRound: invalid input");
  return Math.round((ms * fps) / 1000);
}

/** Frame index → milliseconds at the start of that frame. */
export function frameToMs(frame: number, fps: number): number {
  if (!Number.isFinite(frame) || fps <= 0) throw new RangeError("frameToMs: invalid input");
  return (frame * 1000) / fps;
}

/** Duration in ms → number of frames needed to cover it (ceil). */
export function durationMsToFrames(durationMs: number, fps: number): number {
  return Math.max(0, Math.ceil((durationMs * fps) / 1000 - 1e-6));
}

function pad(n: number, width = 2): string {
  return String(Math.floor(n)).padStart(width, "0");
}

/** SMPTE-style non-drop timecode HH:MM:SS:FF. */
export function frameToTimecode(frame: number, fps: number): string {
  if (frame < 0) throw new RangeError("frameToTimecode: negative frame");
  const totalSeconds = Math.floor(frame / fps);
  const ff = frame - totalSeconds * fps;
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** Parses HH:MM:SS:FF (or MM:SS:FF / SS:FF) back into a frame index. */
export function timecodeToFrame(tc: string, fps: number): number {
  const parts = tc.trim().split(":").map((p) => {
    if (!/^\d+$/.test(p)) throw new RangeError(`timecodeToFrame: invalid segment "${p}"`);
    return Number(p);
  });
  if (parts.length < 2 || parts.length > 4) throw new RangeError(`timecodeToFrame: invalid timecode "${tc}"`);
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts as [number, number, number, number];
  if (mm > 59 || ss > 59 || ff >= fps) throw new RangeError(`timecodeToFrame: out of range "${tc}"`);
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

/** 00:00:01,250 (SRT). */
export function msToSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** 00:00:01.250 (WebVTT). */
export function msToVttTime(ms: number): string {
  return msToSrtTime(ms).replace(",", ".");
}

/** Human friendly 1:05.3 display used across the UI. */
export function formatDurationMs(ms: number): string {
  const totalTenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${pad(seconds)}.${tenths}`;
}
