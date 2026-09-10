import { parseHtml, type ParsedPage } from "./html.js";
import { assertUrlAllowed, type UrlGuardOptions } from "./urlGuard.js";

export class FetchError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface FetchOptions extends UrlGuardOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  parsed: ParsedPage;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  userAgent: "PrepKitBot/1.0 (+interview-prep-kit; respects robots.txt)",
};

/** Content types we are willing to process — HTML/text only. */
function isAllowedContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml") || ct.startsWith("text/");
}

/**
 * Fetch and clean a single page, treating everything about the response as
 * untrusted: the URL is SSRF-checked first, the content type must be textual,
 * the body is capped, and the request is bounded by a timeout. Throws a coded
 * FetchError so the crawler can skip-and-record rather than fail the whole run.
 */
export async function fetchPage(rawUrl: string, opts: FetchOptions): Promise<FetchedPage> {
  const { url } = await assertUrlAllowed(rawUrl, opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": opts.userAgent ?? DEFAULTS.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new FetchError(
      aborted ? "TIMEOUT" : "NETWORK_ERROR",
      aborted ? `Request timed out after ${timeoutMs}ms` : `Fetch failed: ${(err as Error).message}`,
    );
  }

  try {
    if (!res.ok) {
      throw new FetchError("HTTP_ERROR", `Request returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!isAllowedContentType(contentType)) {
      throw new FetchError("UNSUPPORTED_CONTENT_TYPE", `Refusing content type: ${contentType || "unknown"}`);
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > maxBytes) {
      throw new FetchError("TOO_LARGE", `Body ${declaredLength} bytes exceeds cap ${maxBytes}`);
    }

    const html = await readCapped(res, maxBytes);
    const parsed = parseHtml(html, res.url || url.toString());

    return {
      requestedUrl: rawUrl,
      finalUrl: res.url || url.toString(),
      status: res.status,
      contentType,
      parsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchError("TOO_LARGE", `Body exceeded cap of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf-8");
}
