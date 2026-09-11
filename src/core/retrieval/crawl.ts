import { fetchPage, FetchError, type FetchOptions } from "./fetchPage.js";
import { HostLimiter } from "./hostLimiter.js";
import { hiringContentScore, rankLinks, scoreLink, type ScoredLink } from "./linkRank.js";
import { RobotsCache } from "./robots.js";

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  /** Confidence this page documents a hiring/interview process. */
  hiringConfidence: number;
  aboutScore: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  hiringPage: CrawledPage | null;
  aboutPage: CrawledPage | null;
  /** URLs actually fetched — feeds kit.source.pages_used. */
  pagesUsed: string[];
  /** Honest, human-readable notes (skipped sources, nothing found, etc.). */
  notes: string[];
}

export class CrawlError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

export interface CrawlOptions extends FetchOptions {
  maxDepth?: number;
  maxPages?: number;
  minHostIntervalMs?: number;
}

interface FrontierItem {
  link: ScoredLink;
  depth: number;
}

/**
 * Best-first crawl of a company site. Starting from the homepage we rank every
 * link by anchor/URL signal and always fetch the most promising one next, so a
 * hiring page buried three clicks deep under /handbook/joining/... is still
 * found without any path being hard-coded. Individual page failures are
 * recorded and skipped; only an unreachable homepage fails the crawl.
 */
export async function crawlCompanySite(seedUrl: string, opts: CrawlOptions): Promise<CrawlResult> {
  const maxDepth = opts.maxDepth ?? 2;
  const maxPages = opts.maxPages ?? 8;
  const robots = new RobotsCache(opts);
  const limiter = new HostLimiter(opts.minHostIntervalMs ?? 400);
  const notes: string[] = [];

  let seedOrigin: string;
  try {
    seedOrigin = new URL(seedUrl).origin;
  } catch {
    throw new CrawlError("INVALID_URL", `Invalid company URL: ${seedUrl}`);
  }

  // 1. Homepage — a hard failure for the case if it cannot be retrieved.
  let home;
  try {
    await limiter.acquire(seedOrigin);
    home = await fetchPage(seedUrl, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CrawlError("COMPANY_UNREACHABLE", `Could not fetch company homepage: ${msg}`);
  }

  const visited = new Set<string>([normalize(home.finalUrl)]);
  const pages: CrawledPage[] = [pageFrom(home.finalUrl, home.parsed.title, home.parsed.text)];

  // Seed the frontier with the homepage's same-origin links.
  const frontier: FrontierItem[] = [];
  pushLinks(frontier, home.parsed.links, 1, seedOrigin, visited);

  // 2. Best-first expansion.
  while (frontier.length > 0 && pages.length < maxPages) {
    frontier.sort((a, b) => b.link.relevance - a.link.relevance);
    const next = frontier.shift()!;
    const url = normalize(next.link.href);
    if (visited.has(url)) continue;
    visited.add(url);

    // Skip links with no positive signal once we already have the homepage —
    // avoids burning the page budget on footers, logins and legal pages.
    if (next.link.relevance <= 0) continue;

    if (!(await robots.isAllowed(next.link.href))) {
      notes.push(`Skipped (robots.txt disallow): ${next.link.href}`);
      continue;
    }

    try {
      await limiter.acquire(seedOrigin);
      const page = await fetchPage(next.link.href, opts);
      pages.push(
        pageFrom(page.finalUrl, page.parsed.title, page.parsed.text, next.link),
      );
      if (next.depth < maxDepth) {
        pushLinks(frontier, page.parsed.links, next.depth + 1, seedOrigin, visited);
      }
    } catch (err) {
      const code = err instanceof FetchError ? err.code : "FETCH_FAILED";
      notes.push(`Skipped (${code}): ${next.link.href}`);
    }
  }

  // 3. Pick the best hiring and about pages from what we fetched.
  const hiringPage = pickHiringPage(pages);
  const aboutPage = pickAboutPage(pages, home.finalUrl);

  if (!hiringPage) {
    notes.push("No hiring or interview-process page was found on the company site.");
  }

  return {
    pages,
    hiringPage,
    aboutPage,
    pagesUsed: pages.map((p) => p.url),
    notes,
  };
}

function normalize(href: string): string {
  try {
    const u = new URL(href);
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}

function pageFrom(url: string, title: string, text: string, viaLink?: ScoredLink): CrawledPage {
  const linkHiring = viaLink?.hiring ?? 0;
  const linkAbout = viaLink?.about ?? 0;
  return {
    url,
    title,
    text,
    hiringConfidence: linkHiring + hiringContentScore(text),
    aboutScore: linkAbout,
  };
}

function pushLinks(
  frontier: FrontierItem[],
  links: { href: string; text: string }[],
  depth: number,
  seedOrigin: string,
  visited: Set<string>,
) {
  for (const scored of rankLinks(links)) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(scored.href).origin === seedOrigin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) continue;
    if (visited.has(normalize(scored.href))) continue;
    frontier.push({ link: scored, depth });
  }
}

function pickHiringPage(pages: CrawledPage[]): CrawledPage | null {
  const ranked = [...pages]
    .filter((p) => p.hiringConfidence >= 3)
    .sort((a, b) => b.hiringConfidence - a.hiringConfidence);
  return ranked[0] ?? null;
}

function pickAboutPage(pages: CrawledPage[], homeUrl: string): CrawledPage | null {
  const byAbout = [...pages].sort((a, b) => b.aboutScore - a.aboutScore);
  if (byAbout[0] && byAbout[0].aboutScore > 0) return byAbout[0];
  // Fall back to the homepage — it usually states what the company does.
  return pages.find((p) => p.url === normalize(homeUrl)) ?? pages[0] ?? null;
}

export { scoreLink };
