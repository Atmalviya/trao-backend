import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for live job progress.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export interface JobUpdate {
  jobId: string;
  kitId: string;
  status: "running" | "done" | "failed";
  steps: unknown[];
  error: { code: string; message: string } | null;
}

export function publishJobUpdate(update: JobUpdate): void {
  emitter.emit(update.jobId, update);
}

export function subscribeJob(jobId: string, listener: (u: JobUpdate) => void): () => void {
  emitter.on(jobId, listener);
  return () => emitter.off(jobId, listener);
}
