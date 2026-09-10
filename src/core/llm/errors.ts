import { RateLimitError, TransientError } from "./types.js";

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const v = e[key];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  return undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const headers = (err as { headers?: Record<string, string> }).headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

export function normalizeProviderError(err: unknown): never {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : String(err);

  if (status === 429) {
    throw new RateLimitError(message, retryAfterMs(err));
  }
  if (status === 408 || (status !== undefined && status >= 500 && status < 600)) {
    throw new TransientError(message);
  }
  if (status === undefined && /network|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    throw new TransientError(message);
  }
  throw err;
}
