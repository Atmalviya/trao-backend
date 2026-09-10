import { RateLimitError, TransientError } from "./types.js";

export interface RateLimitOptions {
  requestsPerMinute: number;
  tokensPerMinute: number;
  maxAttempts: number;
  baseBackoffMs: number;
}

export const defaultRateLimitOptions: RateLimitOptions = {
  requestsPerMinute: 10,
  tokensPerMinute: 200_000,
  maxAttempts: 5,
  baseBackoffMs: 2_000,
};

interface Stamp {
  at: number;
  tokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serial rate-limit gate shared by every LLM call in the pipeline. */
export class RateLimitedQueue {
  private readonly opts: RateLimitOptions;
  private history: Stamp[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: Partial<RateLimitOptions> = {}) {
    this.opts = { ...defaultRateLimitOptions, ...opts };
  }

  /** Enqueue a task; resolves with its result once the window allows + it runs. */
  run<T>(estimatedTokens: number, task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => this.execute(estimatedTokens, task));
    // Keep the chain alive even if this task rejects, so later tasks still run.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private prune(now: number) {
    const cutoff = now - 60_000;
    this.history = this.history.filter((s) => s.at > cutoff);
  }

  /** Ms to wait until starting a request of `tokens` size stays within budget. */
  private waitTime(now: number, tokens: number): number {
    this.prune(now);
    let wait = 0;

    if (this.history.length >= this.opts.requestsPerMinute) {
      const oldest = this.history[this.history.length - this.opts.requestsPerMinute];
      if (oldest) wait = Math.max(wait, oldest.at + 60_000 - now);
    }

    const usedTokens = this.history.reduce((sum, s) => sum + s.tokens, 0);
    if (usedTokens + tokens > this.opts.tokensPerMinute && this.history.length > 0) {
      const oldest = this.history[0];
      if (oldest) wait = Math.max(wait, oldest.at + 60_000 - now);
    }

    return Math.max(0, wait);
  }

  private async execute<T>(estimatedTokens: number, task: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;

      let wait = this.waitTime(Date.now(), estimatedTokens);
      while (wait > 0) {
        await sleep(wait);
        wait = this.waitTime(Date.now(), estimatedTokens);
      }

      this.history.push({ at: Date.now(), tokens: estimatedTokens });

      try {
        return await task();
      } catch (err) {
        const retryable = err instanceof RateLimitError || err instanceof TransientError;
        if (!retryable || attempt >= this.opts.maxAttempts) {
          throw err;
        }
        const hinted = err instanceof RateLimitError ? err.retryAfterMs : undefined;
        const backoff =
          hinted ??
          this.opts.baseBackoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        await sleep(backoff);
      }
    }
  }
}
