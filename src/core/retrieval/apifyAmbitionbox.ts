import { ApifyClient } from "apify-client";
import {
  ambitionBoxSlugFromCompany,
  selectAmbitionBoxInterviewsForRole,
  type AmbitionBoxInterviewItem,
  type AmbitionBoxSelection,
  type RoleContext,
} from "./ambitionbox.js";

const INTERVIEW_ACTOR = "getdataforme/ambition-interview-scraper";

export interface ApifyAmbitionBoxOptions {
  companyUrl?: string;
  role?: RoleContext;
  maxPages?: number;
  maxResults?: number;
}

/**
 * Fetch company-scoped interview questions from AmbitionBox via Apify,
 * filtered to job profiles that match the target role from the JD.
 */
export async function fetchAmbitionBoxInterviews(
  company: string,
  apifyToken: string,
  opts: ApifyAmbitionBoxOptions = {},
): Promise<AmbitionBoxSelection> {
  const slug = ambitionBoxSlugFromCompany(company, opts.companyUrl);
  if (!slug) {
    return { results: [], totalScraped: 0, matchedProfiles: [] };
  }

  const client = new ApifyClient({ token: apifyToken });
  const run = await client.actor(INTERVIEW_ACTOR).call({
    companyName: slug,
    maxRequestsPerCrawl: opts.maxPages ?? 2,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const scraped = items as AmbitionBoxInterviewItem[];

  return selectAmbitionBoxInterviewsForRole(
    scraped,
    slug,
    opts.role ?? { roleTitle: "", seniority: "" },
    opts.maxResults ?? 15,
  );
}
