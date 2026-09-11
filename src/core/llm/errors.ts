import { QuotaExhaustedError, RateLimitError, TransientError } from "./types.js";


const STATUS_NAME_TO_CODE: Record<string, number> = {
  RESOURCE_EXHAUSTED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
  DEADLINE_EXCEEDED: 504,
  ABORTED: 409,
  NOT_FOUND: 404,
  INVALID_ARGUMENT: 400,
  PERMISSION_DENIED: 403,
  UNAUTHENTICATED: 401,
};

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const v = e[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      if (/^\d+$/.test(v)) return Number(v);
      const mapped = STATUS_NAME_TO_CODE[v];
      if (mapped) return mapped;
    }
  }

  // Fall back to digging the numeric code / status name out of the message,
  const message = e["message"];
  if (typeof message === "string") {
    const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
    if (codeMatch?.[1]) return Number(codeMatch[1]);
    for (const [name, code] of Object.entries(STATUS_NAME_TO_CODE)) {
      if (message.includes(name)) return code;
    }
  }
  return undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;

  const headers = (e as { headers?: Record<string, string> }).headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return secs * 1000;
  }

  // Get "retryDelay":"24s" from the message body.
  const message = typeof e["message"] === "string" ? (e["message"] as string) : "";
  const delayMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (delayMatch?.[1]) return Math.ceil(Number(delayMatch[1]) * 1000);
  return undefined;
}

export function normalizeProviderError(err: unknown): never {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : String(err);

  if (status === 429) {

    if (/per\s*day|PerDay|RequestsPerDay|free_tier_requests/i.test(message)) {
      throw new QuotaExhaustedError(message);
    }
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
