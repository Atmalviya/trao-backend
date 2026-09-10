/**
 * Per-host request spacing. The brief requires we rate-limit our own crawling
 * and back off on failure; this keeps a minimum gap between requests to the
 * same host so we are a polite crawler regardless of how many pages we queue.
 */
export class HostLimiter {
  private lastRequestAt = new Map<string, number>();

  constructor(private minIntervalMs = 500) {}

  async acquire(host: string): Promise<void> {
    const now = Date.now();
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + this.minIntervalMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt.set(host, Date.now());
  }
}
