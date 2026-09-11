import * as cheerio from "cheerio";
import { fetchAmbitionBoxInterviews } from "./apifyAmbitionbox.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type DiscussionSource = "ambitionbox" | "tavily" | "duckduckgo" | "none";

export interface DiscussionSearch {
  results: SearchResult[];
  source: DiscussionSource;
  note: string;
}

export interface SearchOptions {
  companyUrl?: string;
  roleTitle?: string;
  seniority?: string;
  apifyApiToken?: string;
  tavilyApiKey?: string;
  maxResults?: number;
  ambitionBoxMaxPages?: number;
  timeoutMs?: number;
}

/**
 * Look for public discussion of how a company interviews.
 * Order: AmbitionBox (Apify) -> Tavily -> DuckDuckGo -> honest empty result.
 */
export async function searchInterviewDiscussion(
  company: string,
  opts: SearchOptions = {},
): Promise<DiscussionSearch> {
  const max = opts.maxResults ?? 15;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const query = `"${company}" interview process experience`;

  if (opts.apifyApiToken) {
    try {
      const selection = await fetchAmbitionBoxInterviews(company, opts.apifyApiToken, {
        companyUrl: opts.companyUrl,
        role: {
          roleTitle: opts.roleTitle ?? "",
          seniority: opts.seniority,
        },
        maxPages: opts.ambitionBoxMaxPages ?? 2,
        maxResults: max,
      });
      if (selection.results.length > 0) {
        const profileHint =
          selection.matchedProfiles.length > 0
            ? ` (${selection.matchedProfiles.slice(0, 3).join(", ")}${selection.matchedProfiles.length > 3 ? ", …" : ""})`
            : "";
        const roleHint = opts.roleTitle?.trim() ? ` for ${opts.roleTitle.trim()}` : "";
        return {
          results: selection.results,
          source: "ambitionbox",
          note:
            `Found ${selection.results.length} AmbitionBox interview question(s)${roleHint}` +
            ` from ${selection.totalScraped} scraped${profileHint}.`,
        };
      }
    } catch {
      /* fall through to web search */
    }
  }

  if (opts.tavilyApiKey) {
    try {
      const results = await tavily(query, opts.tavilyApiKey, Math.min(max, 5), timeoutMs);
      if (results.length > 0) {
        return { results, source: "tavily", note: `Found ${results.length} results via Tavily.` };
      }
    } catch {
      /* fall through to DuckDuckGo */
    }
  }

  try {
    const results = await duckduckgo(query, Math.min(max, 5), timeoutMs);
    if (results.length > 0) {
      return {
        results,
        source: "duckduckgo",
        note: `Found ${results.length} results via DuckDuckGo.`,
      };
    }
  } catch {
    /* fall through to none */
  }

  return {
    results: [],
    source: "none",
    note: "No public discussion of the company's interview process was found.",
  };
}

async function tavily(
  query: string,
  apiKey: string,
  maxResults: number,
  timeoutMs: number,
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function duckduckgo(
  query: string,
  maxResults: number,
  timeoutMs: number,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; PrepKitBot/1.0)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $(".result__body").each((_, el) => {
    if (results.length >= maxResults) return;
    const anchor = $(el).find("a.result__a").first();
    const title = anchor.text().trim();
    const href = anchor.attr("href");
    const snippet = $(el).find(".result__snippet").first().text().trim();
    if (title && href) {
      let real = href;
      try {
        const u = new URL(href, "https://duckduckgo.com");
        real = u.searchParams.get("uddg") ?? href;
      } catch {
        /* keep href */
      }
      results.push({ title, url: real, snippet });
    }
  });
  return results;
}
