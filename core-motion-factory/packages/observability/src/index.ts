import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api";

/**
 * Structured JSON logging + OpenTelemetry tracing helpers.
 * Logs never include secrets or raw media content; callers pass ids and metrics.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

const REDACT_KEYS = /pass(word)?|secret|token|authorization|api[-_]?key|cookie/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}, sink: (line: string) => void = (l) => process.stderr.write(l + "\n")): Logger {
  const min = LEVELS[(process.env.CMF_LOG_LEVEL as LogLevel) ?? "info"] ?? LEVELS.info;
  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVELS[level] < min) return;
    const span = trace.getSpan(context.active());
    const spanCtx = span?.spanContext();
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...redact(base),
        ...(fields ? redact(fields) : {}),
        ...(spanCtx ? { otelTraceId: spanCtx.traceId, otelSpanId: spanCtx.spanId } : {}),
      }),
    );
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

export const rootLogger = createLogger({ service: process.env.CMF_SERVICE_NAME ?? "cmf" });

const tracer = trace.getTracer("core-motion-factory", "1.0.0");

/**
 * Runs `fn` inside an OpenTelemetry span. `cmf.trace_id` (our business trace id) is attached
 * as an attribute so the request → orchestrator → agent → tool → render → approval chain can
 * be joined even when no OTel exporter is configured.
 */
export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Simple in-process timer for latency metrics stored on agent runs / renders. */
export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}

/**
 * Optional OTLP export. Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set and the optional
 * @opentelemetry/sdk-node package is installed. Kept dynamic so the core has no hard dependency.
 */
export async function initTelemetry(serviceName: string): Promise<boolean> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  try {
    const mod = (await import(/* webpackIgnore: true */ "@opentelemetry/sdk-node" as string)) as {
      NodeSDK: new (opts: { serviceName: string }) => { start(): void };
    };
    new mod.NodeSDK({ serviceName }).start();
    rootLogger.info("telemetry.started", { serviceName });
    return true;
  } catch (err) {
    rootLogger.warn("telemetry.unavailable", { reason: (err as Error).message });
    return false;
  }
}
