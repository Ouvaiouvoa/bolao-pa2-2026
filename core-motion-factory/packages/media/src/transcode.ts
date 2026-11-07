import { readFile } from "node:fs/promises";
import { ffmpeg, type RunOptions } from "./ffmpeg";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Fits (w,h) inside a box keeping aspect ratio, even dimensions (H.264 requirement). */
export function fitInside(w: number, h: number, maxLongSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxLongSide / Math.max(w, h));
  return { width: even(w * scale), height: even(h * scale) };
}

export interface VideoEncodeOptions extends RunOptions {
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  fps: number;
}

/**
 * Editing proxy: CFR, H.264 baseline-friendly, keyframe every 0.5s for fast scrubbing,
 * AAC 48k stereo, faststart so browsers can stream it.
 */
export async function makeProxy(input: string, output: string, opts: VideoEncodeOptions): Promise<{ width: number; height: number; fps: number }> {
  const { width, height } = fitInside(opts.sourceWidth, opts.sourceHeight, 1280);
  const gop = Math.max(1, Math.round(opts.fps / 2));
  await ffmpeg(
    [
      "-i", input,
      "-map", "0:v:0", ...(opts.hasAudio ? ["-map", "0:a:0"] : []),
      "-vf", `scale=${width}:${height}:flags=bicubic,fps=${opts.fps},format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0",
      ...(opts.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"] : ["-an"]),
      "-movflags", "+faststart",
      output,
    ],
    opts,
  );
  return { width, height, fps: opts.fps };
}

/** High quality CFR mezzanine used by the master render (originals stay untouched and immutable). */
export async function makeMezzanine(input: string, output: string, opts: VideoEncodeOptions): Promise<{ width: number; height: number; fps: number }> {
  const { width, height } = fitInside(opts.sourceWidth, opts.sourceHeight, 2160);
  await ffmpeg(
    [
      "-i", input,
      "-map", "0:v:0", ...(opts.hasAudio ? ["-map", "0:a:0"] : []),
      "-vf", `scale=${width}:${height}:flags=lanczos,fps=${opts.fps},format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", String(opts.fps),
      ...(opts.hasAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"] : ["-an"]),
      "-movflags", "+faststart",
      output,
    ],
    opts,
  );
  return { width, height, fps: opts.fps };
}

/** Mono 16 kHz PCM WAV — the canonical input of every ASR provider. */
export async function extractAudioWav(input: string, output: string, sampleRate = 16000, opts: RunOptions = {}): Promise<void> {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", output], opts);
}

/** Thumbnails at evenly spaced timestamps (skipping the very first/last frames). */
export async function makeThumbnails(input: string, outputs: string[], durationMs: number, width = 480): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const at = Math.max(0, Math.min(durationMs - 100, ((i + 0.5) / outputs.length) * durationMs));
    times.push(Math.round(at));
    await ffmpeg(["-ss", (at / 1000).toFixed(3), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", outputs[i]!], {
      timeoutMs: 60_000,
    });
  }
  return times;
}

/** Single still at a given time (used for render thumbnails/capas). */
export async function extractStill(input: string, output: string, atMs: number, width?: number): Promise<void> {
  await ffmpeg(["-ss", (atMs / 1000).toFixed(3), "-i", input, "-frames:v", "1", ...(width ? ["-vf", `scale=${width}:-2`] : []), "-q:v", "3", output], {
    timeoutMs: 60_000,
  });
}

/**
 * Waveform peaks from the 16k WAV: one absolute peak (0..1) per bucket.
 * Pure Node — reads PCM directly, no extra tools.
 */
export async function computeWaveformPeaks(wavPath: string, peaksPerSecond = 50): Promise<{ peaks: number[]; sampleRate: number }> {
  const buf = await readFile(wavPath);
  const { sampleRate, dataOffset, dataLength } = parseWavHeader(buf);
  const samples = dataLength / 2;
  const bucket = Math.max(1, Math.floor(sampleRate / peaksPerSecond));
  const peaks: number[] = [];
  for (let start = 0; start < samples; start += bucket) {
    let peak = 0;
    const end = Math.min(samples, start + bucket);
    for (let i = start; i < end; i++) {
      const v = Math.abs(buf.readInt16LE(dataOffset + i * 2)) / 32768;
      if (v > peak) peak = v;
    }
    peaks.push(Math.round(peak * 1000) / 1000);
  }
  return { peaks, sampleRate };
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export function parseWavHeader(buf: Buffer): WavInfo {
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") throw new Error("WAV inválido");
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bits: number } | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("latin1", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(offset + 10), sampleRate: buf.readUInt32LE(offset + 12), bits: buf.readUInt16LE(offset + 22) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV sem chunk fmt");
      if (fmt.bits !== 16 || fmt.channels !== 1) throw new Error("WAV deve ser PCM 16-bit mono");
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, dataOffset: offset + 8, dataLength: Math.min(size, buf.length - offset - 8) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV sem chunk data");
}

/** Reads a 16-bit mono WAV as Float32 samples (ASR input). */
export async function readWavFloat32(wavPath: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await readFile(wavPath);
  const info = parseWavHeader(buf);
  const n = info.dataLength / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(info.dataOffset + i * 2) / 32768;
  return { samples, sampleRate: info.sampleRate };
}

/** RMS energy (0..1) of a time range of a Float32 signal. */
export function rmsEnergy(samples: Float32Array, sampleRate: number, startMs: number, endMs: number): number {
  const a = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
  const b = Math.min(samples.length, Math.ceil((endMs / 1000) * sampleRate));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (b - a));
}

/**
 * Two-stage master finishing: EBU R128 loudness normalisation of the audio track while
 * copying the video stream untouched.
 */
export async function loudnormMaster(input: string, output: string, targetLufs: number, truePeakDb: number, opts: RunOptions = {}): Promise<void> {
  await ffmpeg(
    [
      "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "copy",
      "-af", `loudnorm=I=${targetLufs}:TP=${truePeakDb}:LRA=11,aresample=48000`,
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      output,
    ],
    opts,
  );
}
