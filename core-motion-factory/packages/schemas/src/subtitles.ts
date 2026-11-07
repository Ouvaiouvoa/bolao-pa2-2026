import { msToSrtTime, msToVttTime } from "./time";

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  lines: string[];
}

function normalizeCues(cues: SubtitleCue[]): SubtitleCue[] {
  return cues
    .filter((c) => c.endMs > c.startMs && c.lines.some((l) => l.trim().length > 0))
    .sort((a, b) => a.startMs - b.startMs)
    .map((c, i, arr) => {
      const next = arr[i + 1];
      // Never let cues overlap: some players render overlapping cues stacked.
      const endMs = next && c.endMs > next.startMs ? next.startMs : c.endMs;
      return { ...c, endMs };
    });
}

export function toSrt(cues: SubtitleCue[]): string {
  return normalizeCues(cues)
    .map((c, i) => `${i + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.lines.join("\n")}\n`)
    .join("\n");
}

export function toVtt(cues: SubtitleCue[]): string {
  const body = normalizeCues(cues)
    .map((c, i) => `${i + 1}\n${msToVttTime(c.startMs)} --> ${msToVttTime(c.endMs)}\n${c.lines.join("\n")}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** Parses SRT back into cues (used by tests and by imports of existing subtitles). */
export function parseSrt(srt: string): SubtitleCue[] {
  const blocks = srt.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const toMs = (t: string) => {
    const m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(t.trim());
    if (!m) throw new Error(`timestamp SRT inválido: ${t}`);
    return Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4]);
  };
  return blocks
    .filter((b) => b.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const timing = lines.find((l) => l.includes("-->"));
      if (!timing) throw new Error("bloco SRT sem tempo");
      const [a, b] = timing.split("-->") as [string, string];
      const textLines = lines.slice(lines.indexOf(timing) + 1).filter((l) => l.length > 0);
      return { startMs: toMs(a), endMs: toMs(b), lines: textLines };
    });
}
