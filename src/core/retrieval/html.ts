import * as cheerio from "cheerio";

export interface ExtractedLink {
  href: string;
  text: string;
}

export interface ParsedPage {
  title: string;
  text: string;
  links: ExtractedLink[];
}

/** Turn raw HTML into clean text + resolved links. */
export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, iframe, template").remove();

  const title = $("title").first().text().trim() || $("h1").first().text().trim();

  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href");
    if (!rawHref) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    let abs: string;
    try {
      abs = new URL(rawHref, baseUrl).toString();
    } catch {
      return;
    }
    const u = new URL(abs);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    u.hash = "";
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ href: key, text });
  });

  const text = $("body").text().replace(/\s+/g, " ").trim();

  return { title, text, links };
}
