import { Queue, type JobsOptions } from "bullmq";
import type { JobState } from "@cmf/schemas";
import { redisConnectionOptions } from "./redis";

export const STAGE_QUEUE = "cmf-stages";

export interface StageJobData {
  projectId: string;
  organizationId: string;
  stage: JobState;
  attempt: number;
  /** Project-wide monotonic stage sequence (part of the idempotency key). */
  seq: number;
  traceId: string;
  reason: string;
  /** Idempotency key: the same key is never executed twice. */
  idempotencyKey: string;
}

/** Queue abstraction (section 8: "abstrair para troca futura"). */
export interface StageQueue {
  enqueue(data: StageJobData): Promise<{ jobId: string; deduplicated: boolean }>;
  counts(): Promise<{ waiting: number; active: number; delayed: number; failed: number; completed: number }>;
  close(): Promise<void>;
}

class BullStageQueue implements StageQueue {
  private readonly queue = new Queue(STAGE_QUEUE, { connection: redisConnectionOptions() });

  async enqueue(data: StageJobData) {
    const jobId = data.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "_");
    const existing = await this.queue.getJob(jobId);
    if (existing) return { jobId, deduplicated: true };
    const opts: JobsOptions = {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    };
    await this.queue.add(`stage:${data.stage}`, data, opts);
    return { jobId, deduplicated: false };
  }

  async counts() {
    const c = await this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
  }

  async close() {
    await this.queue.close();
  }
}

let instance: StageQueue | null = null;

export function getStageQueue(): StageQueue {
  instance ??= new BullStageQueue();
  return instance;
}

export function setStageQueue(q: StageQueue | null): void {
  instance = q;
}

export function stageIdempotencyKey(projectId: string, stage: JobState, seq: number): string {
  return `${projectId}_${stage}_s${seq}`;
}
