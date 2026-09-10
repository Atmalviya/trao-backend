import robotsParserImport from "robots-parser";
import { assertUrlAllowed, type UrlGuardOptions } from "./urlGuard.js";

const DEFAULT_UA = "PrepKitBot";

interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
type RobotsParserFn = (url: string, robotstxt: string) => Robot;
const robotsParser = robotsParserImport as unknown as RobotsParserFn;

export class RobotsCache {
  private cache = new Map<string, Robot | null>();

  constructor(
    private guard: UrlGuardOptions,
    private userAgent = DEFAULT_UA,
  ) {}

  private async load(origin: string): Promise<Robot | null> {
    if (this.cache.has(origin)) return this.cache.get(origin) ?? null;

    const robotsUrl = `${origin}/robots.txt`;
    let parser: Robot | null = null;
    try {
      await assertUrlAllowed(robotsUrl, this.guard);
      const res = await fetch(robotsUrl, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        parser = robotsParser(robotsUrl, await res.text());
      }
    } catch {
      parser = null;
    }
    this.cache.set(origin, parser);
    return parser;
  }

  async isAllowed(rawUrl: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    const parser = await this.load(url.origin);
    if (!parser) return true;
    return parser.isAllowed(rawUrl, this.userAgent) ?? true;
  }
}
