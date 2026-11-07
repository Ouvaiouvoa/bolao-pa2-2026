import { spawn } from "node:child_process";

export const FFMPEG_BIN = process.env.CMF_FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE_BIN = process.env.CMF_FFPROBE_PATH ?? "ffprobe";

export class MediaToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stderrTail: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MediaToolError";
  }
}

export interface RunOptions {
  timeoutMs?: number;
  /** Called with 0..1 when `durationMs` is provided and ffmpeg reports out_time. */
  onProgress?: (fraction: number) => void;
  durationMs?: number;
  signal?: AbortSignal;
  collectStdout?: boolean;
  maxStdoutBytes?: number;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  durationMs: number;
}

/** Runs a binary without a shell (no injection), with timeout, progress and bounded stderr capture. */
export function runTool(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let progressBuf = "";
    const maxStdout = opts.maxStdoutBytes ?? 512 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      if (opts.collectStdout) {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxStdout) {
          child.kill("SIGKILL");
          reject(new MediaToolError(`${bin}: saída excedeu ${maxStdout} bytes`, "STDOUT_TOO_LARGE", "", false));
          return;
        }
        stdoutChunks.push(chunk);
      } else if (opts.onProgress && opts.durationMs) {
        progressBuf += chunk.toString();
        const lines = progressBuf.split("\n");
        progressBuf = lines.pop() ?? "";
        for (const line of lines) {
          const m = /^out_time_(?:ms|us)=(\d+)/.exec(line);
          if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1000 / opts.durationMs));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new MediaToolError(`${bin}: tempo limite de ${opts.timeoutMs}ms excedido`, "TIMEOUT", stderr.slice(-2000), true));
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new MediaToolError(`${bin}: ${err.message}`, "SPAWN_FAILED", "", false));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(stdoutChunks), stderr, durationMs: Date.now() - started });
      else reject(new MediaToolError(`${bin} terminou com código ${code}`, "NONZERO_EXIT", stderr.slice(-4000), false));
    });
  });
}

/** ffmpeg with sane defaults: no stdin, hide banner, overwrite, machine-readable progress on stdout. */
export function ffmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const base = ["-hide_banner", "-nostdin", "-y"];
  const progress = opts.onProgress && !opts.collectStdout ? ["-progress", "pipe:1", "-nostats"] : [];
  return runTool(FFMPEG_BIN, [...base, ...progress, ...args], opts);
}

export async function checkMediaTools(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const a = await runTool(FFMPEG_BIN, ["-version"], { collectStdout: true, timeoutMs: 10_000 });
  const b = await runTool(FFPROBE_BIN, ["-version"], { collectStdout: true, timeoutMs: 10_000 });
  return { ffmpeg: a.stdout.toString().split("\n")[0] ?? "", ffprobe: b.stdout.toString().split("\n")[0] ?? "" };
}
