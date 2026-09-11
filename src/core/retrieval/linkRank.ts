import type { ExtractedLink } from "./html.js";

/**
 * Weighted keyword signals for ranking which links are worth fetching. The
 * brief is explicit that hiring pages live at unpredictable paths (/careers,
 * a handbook, an engineering blog) and that a fixed list of paths is not
 * sufficient — so we score links by what the anchor text and URL *say*, not by
 * matching known paths. Both the visible link text and the URL path contribute.
 */
const HIRING_SIGNALS: Record<string, number> = {
  careers: 5,
  career: 5,
  jobs: 5,
  job: 3,
  hiring: 5,
  hire: 3,
  recruiting: 4,
  recruit: 3,
  interview: 5,
  interviewing: 5,
  openings: 4,
  opening: 3,
  vacancies: 4,
  vacancy: 4,
  apply: 3,
  "join-us": 4,
  join: 2,
  handbook: 3,
  onboarding: 2,
  "life-at": 3,
  "working-at": 3,
  "work-with-us": 3,
  "how-we-hire": 5,
  "how-we-work": 4,
  culture: 2,
  people: 1,
};

const ABOUT_SIGNALS: Record<string, number> = {
  about: 4,
  company: 3,
  "what-we-do": 4,
  "who-we-are": 3,
  mission: 3,
  team: 2,
  story: 2,
  values: 2,
  products: 1,
  product: 1,
  platform: 1,
};

const NEGATIVE_SIGNALS: Record<string, number> = {
  login: 4,
  "sign-in": 4,
  signin: 4,
  signup: 3,
  privacy: 4,
  terms: 4,
  legal: 4,
  cookie: 3,
  cookies: 3,
  pricing: 2,
  press: 2,
  news: 1,
  blog: 1,
  contact: 2,
  support: 1,
  status: 2,
};

export interface ScoredLink {
  href: string;
  text: string;
  hiring: number;
  about: number;
  /** Combined priority; hiring is weighted highest since it is the hard find. */
  relevance: number;
}

/** Normalise anchor text + URL path into a space-separated token haystack. */
function haystack(link: ExtractedLink): string {
  let path = "";
  try {
    const u = new URL(link.href);
    path = `${u.pathname} ${u.search}`;
  } catch {
    path = link.href;
  }
  return `${link.text} ${path}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/** Sum weights for signals present as whole tokens or hyphenated phrases. */
function scoreAgainst(haystackText: string, hyphenated: string, table: Record<string, number>) {
  let score = 0;
  for (const [key, weight] of Object.entries(table)) {
    if (key.includes("-")) {
      // phrase like "how-we-hire" — check the de-hyphenated form as a substring
      if (hyphenated.includes(key.replace(/-/g, " "))) score += weight;
    } else {
      const re = new RegExp(`\\b${key}\\b`);
      if (re.test(haystackText)) score += weight;
    }
  }
  return score;
}

export function scoreLink(link: ExtractedLink): ScoredLink {
  const text = haystack(link);
  const hiring = scoreAgainst(text, text, HIRING_SIGNALS);
  const about = scoreAgainst(text, text, ABOUT_SIGNALS);
  const penalty = scoreAgainst(text, text, NEGATIVE_SIGNALS);
  // Hiring pages are the priority target, so weight them above about pages.
  const relevance = hiring * 1.5 + about - penalty;
  return { href: link.href, text: link.text, hiring, about, relevance };
}

/** Rank links best-first; ties broken by shorter (usually higher-level) URLs. */
export function rankLinks(links: ExtractedLink[]): ScoredLink[] {
  return links
    .map(scoreLink)
    .sort((a, b) => b.relevance - a.relevance || a.href.length - b.href.length);
}

/**
 * Content-level hiring signal for a fetched page's text — used to confirm a
 * page really describes a hiring/interview process rather than just matching a
 * URL keyword. Looks for process-specific vocabulary.
 */
const HIRING_CONTENT_PHRASES = [
  "interview process",
  "interview loop",
  "hiring process",
  "take-home",
  "take home",
  "onsite",
  "on-site",
  "system design interview",
  "what to expect",
  "phone screen",
  "coding interview",
  "how we hire",
  "our process",
  "recruiter",
];

export function hiringContentScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const phrase of HIRING_CONTENT_PHRASES) {
    if (lower.includes(phrase)) score += 1;
  }
  return score;
}
