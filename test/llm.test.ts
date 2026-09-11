import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmClient } from "../src/core/llm/client.js";
import { extractJson } from "../src/core/llm/json.js";
import { RateLimitedQueue } from "../src/core/llm/queue.js";
import { normalizeProviderError } from "../src/core/llm/errors.js";
import {
  QuotaExhaustedError,
  RateLimitError,
  TransientError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "../src/core/llm/types.js";

function provider(name: string, impl: (req: LlmRequest) => Promise<LlmResponse>): LlmProvider {
  return { name, model: `${name}-model`, complete: impl };
}

describe("extractJson", () => {
  it("returns bare JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("ignores leading prose and trailing commentary", () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps')).toBe('{"a":1}');
  });
  it("handles braces inside strings", () => {
    const src = '{"a":"a } b","c":2}';
    expect(extractJson(`noise ${src} noise`)).toBe(src);
  });
  it("extracts a top-level array", () => {
    expect(extractJson("result: [1, 2, 3]")).toBe("[1, 2, 3]");
  });
});

describe("RateLimitedQueue", () => {
  it("retries a rate-limited task then succeeds", async () => {
    const q = new RateLimitedQueue({ baseBackoffMs: 1, maxAttempts: 3 });
    let calls = 0;
    const result = await q.run(10, async () => {
      calls++;
      if (calls < 2) throw new RateLimitError("slow down", 1);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after maxAttempts and rethrows", async () => {
    const q = new RateLimitedQueue({ baseBackoffMs: 1, maxAttempts: 2 });
    await expect(
      q.run(10, async () => {
        throw new RateLimitError("still limited", 1);
      }),
    ).rejects.toThrow("still limited");
  });

  it("continues processing later tasks after one fails", async () => {
    const q = new RateLimitedQueue({ baseBackoffMs: 1, maxAttempts: 1 });
    const failing = q.run(10, async () => {
      throw new RateLimitError("nope", 1);
    });
    await expect(failing).rejects.toBeInstanceOf(RateLimitError);
    await expect(q.run(10, async () => "second")).resolves.toBe("second");
  });

  it("spaces requests to respect the per-minute cap", async () => {
    const q = new RateLimitedQueue({ requestsPerMinute: 2, tokensPerMinute: 1_000_000 });
    const start = Date.now();
    // 3rd request must wait for the 60s window; fake timers keep it instant.
    vi.useFakeTimers();
    const p = Promise.all([
      q.run(1, async () => 1),
      q.run(1, async () => 2),
      q.run(1, async () => 3),
    ]);
    await vi.advanceTimersByTimeAsync(61_000);
    const results = await p;
    vi.useRealTimers();
    expect(results).toEqual([1, 2, 3]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeProviderError", () => {
  const genaiError = (code: number, status: string, extra = "") =>
    Object.assign(new Error(`{"error":{"code":${code},"message":"boom"${extra},"status":"${status}"}}`), {
      status,
    });

  it("maps a string RESOURCE_EXHAUSTED status to a retryable rate-limit error", () => {
    try {
      normalizeProviderError(genaiError(429, "RESOURCE_EXHAUSTED"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
    }
  });

  it("maps a string UNAVAILABLE (503) status to a transient error", () => {
    try {
      normalizeProviderError(genaiError(503, "UNAVAILABLE"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TransientError);
    }
  });

  it("extracts the embedded retryDelay hint for rate-limit backoff", () => {
    try {
      normalizeProviderError(genaiError(429, "RESOURCE_EXHAUSTED", ',"retryDelay":"24s"'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterMs).toBe(24_000);
    }
  });

  it("treats a per-day free-tier quota (429) as non-retryable QuotaExhaustedError", () => {
    const dailyQuota = genaiError(
      429,
      "RESOURCE_EXHAUSTED",
      ',"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"',
    );
    try {
      normalizeProviderError(dailyQuota);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExhaustedError);
      expect(err).not.toBeInstanceOf(RateLimitError);
    }
  });

  it("rethrows a genuine non-retryable error (404) as-is", () => {
    const notFound = genaiError(404, "NOT_FOUND");
    expect(() => normalizeProviderError(notFound)).toThrow(notFound);
  });
});

describe("LlmClient", () => {
  const schema = z.object({ answer: z.string() });

  it("returns validated data on a clean response", async () => {
    const client = new LlmClient([
      provider("p1", async () => ({ text: '{"answer":"hi"}', provider: "p1", model: "m" })),
    ]);
    const out = await client.generate({
      system: "s",
      prompt: "p",
      schema,
      label: "t",
    });
    expect(out.answer).toBe("hi");
  });

  it("repairs invalid JSON with a second call", async () => {
    let call = 0;
    const client = new LlmClient([
      provider("p1", async () => {
        call++;
        return call === 1
          ? { text: "not json", provider: "p1", model: "m" }
          : { text: '{"answer":"fixed"}', provider: "p1", model: "m" };
      }),
    ]);
    const out = await client.generate({ system: "s", prompt: "p", schema, label: "t" });
    expect(out.answer).toBe("fixed");
    expect(call).toBe(2);
  });

  it("falls back to the next provider when the first keeps failing", async () => {
    const client = new LlmClient([
      provider("bad", async () => ({ text: "garbage", provider: "bad", model: "m" })),
      provider("good", async () => ({
        text: '{"answer":"from-fallback"}',
        provider: "good",
        model: "m",
      })),
    ]);
    const out = await client.generate({ system: "s", prompt: "p", schema, label: "t" });
    expect(out.answer).toBe("from-fallback");
  });
});
