import { describe, expect, it } from "vitest";
import { durationMsToFrames, formatDurationMs, frameToMs, frameToTimecode, msToFrame, msToSrtTime, msToVttTime, parseSrt, timecodeToFrame, toSrt, toVtt } from "@cmf/schemas";

describe("frame math and timecodes", () => {
  it("converts ms ↔ frames on the 30fps grid without float drift", () => {
    expect(msToFrame(100, 30)).toBe(3);
    expect(msToFrame((1000 / 30) * 3, 30)).toBe(3);
    expect(frameToMs(45, 30)).toBe(1500);
    expect(durationMsToFrames(1000, 30)).toBe(30);
    expect(durationMsToFrames(1001, 30)).toBe(31);
  });
  it("formats and parses SMPTE timecodes (round trip)", () => {
    for (const f of [0, 1, 29, 30, 1799, 108_000 + 17]) expect(timecodeToFrame(frameToTimecode(f, 30), 30)).toBe(f);
    expect(frameToTimecode(3661 * 25 + 7, 25)).toBe("01:01:01:07");
    expect(() => timecodeToFrame("00:00:01:30", 30)).toThrow();
    expect(() => timecodeToFrame("aa:bb", 30)).toThrow();
  });
  it("formats subtitle times", () => {
    expect(msToSrtTime(3_723_045)).toBe("01:02:03,045");
    expect(msToVttTime(1250)).toBe("00:00:01.250");
    expect(formatDurationMs(65_300)).toBe("1:05.3");
  });
  it("builds SRT/VTT, never overlapping cues, and parses back", () => {
    const cues = [
      { startMs: 0, endMs: 1500, lines: ["Olá", "mundo"] },
      { startMs: 1200, endMs: 2500, lines: ["sobreposição"] },
    ];
    const srt = toSrt(cues);
    const parsed = parseSrt(srt);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.endMs).toBe(1200);
    expect(parsed[0]!.lines).toEqual(["Olá", "mundo"]);
    expect(toVtt(cues).startsWith("WEBVTT")).toBe(true);
  });
});
