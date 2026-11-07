import { ffmpeg } from "./ffmpeg";

export interface TimeRange {
  startMs: number;
  endMs: number;
}

/** ffmpeg silencedetect → ranges of silence. */
export async function detectSilences(input: string, opts: { noiseDb?: number; minDurationSec?: number; durationMs: number }): Promise<TimeRange[]> {
  const { stderr } = await ffmpeg(
    ["-i", input, "-vn", "-af", `silencedetect=noise=${opts.noiseDb ?? -35}dB:d=${opts.minDurationSec ?? 0.3}`, "-f", "null", "-"],
    { timeoutMs: 15 * 60_000 },
  );
  return parseSilences(stderr, opts.durationMs);
}

export function parseSilences(stderr: string, durationMs: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]) * 1000);
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && open !== null) {
      ranges.push({ startMs: Math.round(open), endMs: Math.round(Number(e[1]) * 1000) });
      open = null;
    }
  }
  if (open !== null) ranges.push({ startMs: Math.round(open), endMs: durationMs });
  return ranges;
}

/** Scene cut detection using the select filter's scene score. */
export async function detectScenes(input: string, threshold = Number(process.env.CMF_SCENE_THRESHOLD ?? 0.22)): Promise<{ atMs: number; score: number }[]> {
  const { stderr } = await ffmpeg(
    ["-i", input, "-an", "-vf", `scale=320:-2,select='gt(scene,${threshold})',metadata=print`, "-f", "null", "-"],
    { timeoutMs: 15 * 60_000 },
  );
  return parseScenes(stderr);
}

export function parseScenes(stderr: string): { atMs: number; score: number }[] {
  const out: { atMs: number; score: number }[] = [];
  let pendingTime: number | null = null;
  for (const line of stderr.split("\n")) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) pendingTime = Number(t[1]) * 1000;
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s && pendingTime !== null) {
      out.push({ atMs: Math.round(pendingTime), score: Math.round(Number(s[1]) * 1000) / 1000 });
      pendingTime = null;
    }
  }
  return out;
}

export interface LoudnessResult {
  integratedLufs: number | null;
  truePeakDb: number | null;
  lra: number | null;
}

/** EBU R128 measurement (integrated loudness, true peak, loudness range). */
export async function measureLoudness(input: string): Promise<LoudnessResult> {
  const { stderr } = await ffmpeg(["-i", input, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs: 15 * 60_000 });
  return parseEbur128(stderr);
}

export function parseEbur128(stderr: string): LoudnessResult {
  const summaryIdx = stderr.lastIndexOf("Summary:");
  const summary = summaryIdx >= 0 ? stderr.slice(summaryIdx) : stderr;
  const num = (re: RegExp) => {
    const m = re.exec(summary);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    integratedLufs: num(/I:\s*(-?[\d.]+|-inf)\s*LUFS/),
    lra: num(/LRA:\s*(-?[\d.]+)\s*LU/),
    truePeakDb: num(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/),
  };
}

/** blackdetect → black segments (QA: unexpected black frames). */
export async function detectBlack(input: string, minDurationSec = 0.25): Promise<TimeRange[]> {
  const { stderr } = await ffmpeg(["-i", input, "-an", "-vf", `blackdetect=d=${minDurationSec}:pix_th=0.10`, "-f", "null", "-"], {
    timeoutMs: 15 * 60_000,
  });
  const out: TimeRange[] = [];
  for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    out.push({ startMs: Math.round(Number(m[1]) * 1000), endMs: Math.round(Number(m[2]) * 1000) });
  }
  return out;
}

/**
 * Subject framing estimate for vertical reframing, without face detection models:
 * motion energy per column across sampled frames (people move — backgrounds don't),
 * combined with a mild centre prior. Returns the horizontal/vertical focus (0..1).
 */
export async function estimateFocus(
  input: string,
  sourceWidth: number,
  sourceHeight: number,
  durationMs: number,
  range?: TimeRange,
): Promise<{ focusX: number; focusY: number; confidence: number }> {
  const w = 96;
  const h = Math.max(2, Math.round((sourceHeight / sourceWidth) * w / 2) * 2);
  const spanMs = range ? range.endMs - range.startMs : durationMs;
  const samplesPerSec = spanMs > 120_000 ? 0.5 : spanMs < 6000 ? 6 : 2;
  const seek = range ? ["-ss", (range.startMs / 1000).toFixed(3), "-t", (spanMs / 1000).toFixed(3)] : [];
  const { stdout } = await ffmpeg(
    [...seek, "-i", input, "-an", "-vf", `fps=${samplesPerSec},scale=${w}:${h},format=gray`, "-f", "rawvideo", "pipe:1"],
    { collectStdout: true, timeoutMs: 15 * 60_000, maxStdoutBytes: 256 * 1024 * 1024 },
  );
  const frameSize = w * h;
  const frames = Math.floor(stdout.length / frameSize);
  if (frames < 2) return { focusX: 0.5, focusY: 0.5, confidence: 0 };
  const colEnergy = new Float64Array(w);
  const rowEnergy = new Float64Array(h);
  for (let f = 1; f < frames; f++) {
    const a = (f - 1) * frameSize;
    const b = f * frameSize;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.abs(stdout[b + y * w + x]! - stdout[a + y * w + x]!);
        if (d > 6) {
          colEnergy[x]! += d;
          rowEnergy[y]! += d;
        }
      }
    }
  }
  const centroid = (arr: Float64Array, n: number) => {
    let total = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      // Centre prior: gently prefer the middle when energy is diffuse.
      const prior = 1 - 0.35 * Math.abs(i / (n - 1) - 0.5) * 2;
      const v = arr[i]! * prior;
      total += v;
      acc += v * (i + 0.5);
    }
    return total > 0 ? { c: acc / total / n, total } : { c: 0.5, total: 0 };
  };
  const cx = centroid(colEnergy, w);
  const cy = centroid(rowEnergy, h);
  // Confidence = how concentrated the energy is around the centroid.
  let near = 0;
  for (let x = 0; x < w; x++) if (Math.abs((x + 0.5) / w - cx.c) < 0.2) near += colEnergy[x]!;
  const confidence = cx.total > 0 ? Math.min(1, near / cx.total) : 0;
  const clamp = (v: number) => Math.min(0.85, Math.max(0.15, v));
  return { focusX: Math.round(clamp(cx.c) * 1000) / 1000, focusY: Math.round(clamp(cy.c * 0.9) * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}

/** Focus per scene (between detected cuts) so reframing follows camera changes. */
export async function estimateFocusByScene(
  input: string,
  sourceWidth: number,
  sourceHeight: number,
  durationMs: number,
  scenes: { atMs: number }[],
): Promise<{ startMs: number; endMs: number; focusX: number; focusY: number; confidence: number }[]> {
  const bounds = [0, ...scenes.map((s) => s.atMs).filter((t) => t > 500 && t < durationMs - 500), durationMs];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const range = { startMs: bounds[i]!, endMs: bounds[i + 1]! };
    if (range.endMs - range.startMs < 300) continue;
    const f = await estimateFocus(input, sourceWidth, sourceHeight, durationMs, range);
    out.push({ ...range, ...f });
  }
  return out;
}
