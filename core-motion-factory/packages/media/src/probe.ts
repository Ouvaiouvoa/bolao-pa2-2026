import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { FFPROBE_BIN, MediaToolError, runTool } from "./ffmpeg";

export interface ProbeResult {
  durationMs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  rotation: number;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  formatName: string;
  pixFmt: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  pix_fmt?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

function parseRate(rate?: string): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 1000) / 1000;
}

export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await runTool(
    FFPROBE_BIN,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { collectStdout: true, timeoutMs: 60_000 },
  );
  let data: { format?: { duration?: string; bit_rate?: string; format_name?: string }; streams?: FfprobeStream[] };
  try {
    data = JSON.parse(stdout.toString());
  } catch {
    throw new MediaToolError("ffprobe retornou JSON inválido", "PROBE_PARSE", "", false);
  }
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const rotationRaw = video?.side_data_list?.find((s) => typeof s.rotation === "number")?.rotation ?? Number(video?.tags?.rotate ?? 0);
  const rotation = ((Math.round(rotationRaw) % 360) + 360) % 360;
  let width = video?.width ?? null;
  let height = video?.height ?? null;
  if (width && height && (rotation === 90 || rotation === 270)) [width, height] = [height, width];
  const durationSec = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationMs: Math.round(durationSec * 1000),
    width,
    height,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    rotation,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    bitRate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
    formatName: data.format?.format_name ?? "unknown",
    pixFmt: video?.pix_fmt ?? null,
  };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export function sha256Buffer(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Real MIME detection from magic bytes (never trust the extension or the client-declared type). */
export async function sniffMime(path: string): Promise<{ mime: string; kind: "video" | "audio" | "image" | "font" | "unknown" }> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(64);
    const { bytesRead } = await fh.read(buf, 0, 64, 0);
    const b = buf.subarray(0, bytesRead);
    const ascii = (start: number, len: number) => b.subarray(start, start + len).toString("latin1");
    if (bytesRead >= 12 && ascii(4, 4) === "ftyp") {
      const brand = ascii(8, 4);
      if (/^(M4A |M4B |F4A )/.test(brand)) return { mime: "audio/mp4", kind: "audio" };
      if (brand.startsWith("qt")) return { mime: "video/quicktime", kind: "video" };
      if (/^(heic|heix|mif1|avif)/.test(brand)) return { mime: "image/heic", kind: "image" };
      return { mime: "video/mp4", kind: "video" };
    }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
      const doc = b.toString("latin1");
      return doc.includes("webm") ? { mime: "video/webm", kind: "video" } : { mime: "video/x-matroska", kind: "video" };
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { mime: "audio/wav", kind: "audio" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return { mime: "video/x-msvideo", kind: "video" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { mime: "image/webp", kind: "image" };
    if (ascii(0, 3) === "ID3" || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) {
      if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xf6) === 0xf0) return { mime: "audio/aac", kind: "audio" };
      return { mime: "audio/mpeg", kind: "audio" };
    }
    if (ascii(0, 4) === "OggS") return { mime: "audio/ogg", kind: "audio" };
    if (ascii(0, 4) === "fLaC") return { mime: "audio/flac", kind: "audio" };
    if (b[0] === 0x89 && ascii(1, 3) === "PNG") return { mime: "image/png", kind: "image" };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", kind: "image" };
    if (ascii(0, 4) === "wOF2") return { mime: "font/woff2", kind: "font" };
    if (ascii(0, 4) === "wOFF") return { mime: "font/woff", kind: "font" };
    if (ascii(0, 4) === "OTTO") return { mime: "font/otf", kind: "font" };
    if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return { mime: "font/ttf", kind: "font" };
    // SVG is intentionally not accepted (can carry scripts); MPEG-TS needs more than 64 bytes to detect reliably.
    return { mime: "application/octet-stream", kind: "unknown" };
  } finally {
    await fh.close();
  }
}
