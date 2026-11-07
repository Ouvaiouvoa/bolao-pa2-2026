import { Queue, Worker } from "bullmq";
import { and, inArray, isNull } from "drizzle-orm";
import { closeDb, getDb, tables } from "@cmf/db";
import { checkMediaTools } from "@cmf/media";
import { initTelemetry, rootLogger } from "@cmf/observability";
import { closeRedis, getStageQueue, redisConnectionOptions, STAGE_QUEUE, stageIdempotencyKey, type StageJobData, type StageMarker } from "@cmf/orchestration";
import { WORKING_STATES } from "@cmf/schemas";
import { runStage } from "./stage-runner";

const log = rootLogger.child({ service: "cmf-worker" });

/** Re-enqueues working stages whose job never reached the queue (e.g. crash between commit and enqueue). */
async function reconcile(queue: Queue): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: tables.projects.id, organizationId: tables.projects.organizationId, status: tables.projects.status, stageJson: tables.projects.stageJson, traceId: tables.projects.traceId })
    .from(tables.projects)
    .where(and(inArray(tables.projects.status, [...WORKING_STATES]), isNull(tables.projects.deletedAt)));
  for (const p of rows) {
    const marker = p.stageJson as StageMarker | null;
    if (!marker || marker.hold || marker.stage !== p.status) continue;
    const key = stageIdempotencyKey(p.id, marker.stage, marker.seq);
    if (await queue.getJob(key)) continue;
    log.warn("reconcile.requeue", { projectId: p.id, stage: marker.stage, attempt: marker.attempt });
    await getStageQueue().enqueue({ projectId: p.id, organizationId: p.organizationId, stage: marker.stage, attempt: marker.attempt, seq: marker.seq, traceId: p.traceId, reason: "reconciliação", idempotencyKey: key });
  }
}

// A library error must fail the job, never kill the worker process.
process.on("unhandledRejection", (reason) => log.error("worker.unhandled_rejection", { error: (reason as Error)?.message ?? String(reason) }));

async function main() {
  await initTelemetry("cmf-worker");
  const tools = await checkMediaTools();
  log.info("worker.start", { ffmpeg: tools.ffmpeg, concurrency: Number(process.env.CMF_WORKER_CONCURRENCY ?? 2) });
  const worker = new Worker<StageJobData>(
    STAGE_QUEUE,
    async (job) => {
      log.info("stage.start", { projectId: job.data.projectId, stage: job.data.stage, attempt: job.data.attempt, jobAttempt: job.attemptsMade });
      const res = await runStage(job.data, job.attemptsMade);
      log.info("stage.end", { projectId: job.data.projectId, stage: job.data.stage, result: res.status, next: res.next ?? null });
      return res;
    },
    { connection: redisConnectionOptions(), concurrency: Number(process.env.CMF_WORKER_CONCURRENCY ?? 2), lockDuration: 10 * 60_000 },
  );
  worker.on("failed", (job, err) => log.error("stage.failed", { projectId: job?.data.projectId, stage: job?.data.stage, error: err.message }));
  const queue = new Queue(STAGE_QUEUE, { connection: redisConnectionOptions() });
  const interval = setInterval(() => void reconcile(queue).catch((err) => log.error("reconcile.error", { error: (err as Error).message })), 60_000);
  void reconcile(queue).catch(() => undefined);
  const shutdown = async (signal: string) => {
    log.info("worker.shutdown", { signal });
    clearInterval(interval);
    await worker.close();
    await queue.close();
    await getStageQueue().close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker.crash", { error: (err as Error).message });
  process.exit(1);
});
