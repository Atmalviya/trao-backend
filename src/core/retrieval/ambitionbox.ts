export interface AmbitionBoxInterviewItem {
  question?: string;
  jobProfile?: string;
  jobProfileUrl?: string;
  questionUrl?: string;
  companyName?: string;
}

export interface RoleContext {
  roleTitle: string;
  seniority?: string;
}

export interface AmbitionBoxSearchResult {
  title: string;
  url: string;
  snippet: string;
  jobProfile: string;
}

export interface AmbitionBoxSelection {
  results: AmbitionBoxSearchResult[];
  totalScraped: number;
  matchedProfiles: string[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "or",
  "the",
  "to",
  "with",
]);

/** Derive an AmbitionBox company slug from the display name or website URL. */
export function ambitionBoxSlugFromCompany(company: string, companyUrl?: string): string {
  if (companyUrl) {
    try {
      const host = new URL(companyUrl).hostname.replace(/^www\./, "");
      const label = host.split(".")[0] ?? "";
      if (label.length >= 2) return label.toLowerCase();
    } catch {
      /* fall through to company name */
    }
  }

  return company
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ambitionBoxInterviewsUrl(slug: string): string {
  return `https://www.ambitionbox.com/interviews/${slug}-interview-questions`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Score how well an AmbitionBox job profile matches the target role from the JD. */
export function scoreJobProfileMatch(profile: string, role: RoleContext): number {
  const profileTokens = new Set([
    ...tokenize(profile),
    ...tokenize(role.roleTitle.replace(/-/g, " ")),
  ]);
  if (role.seniority) {
    for (const t of tokenize(role.seniority)) profileTokens.add(t);
  }

  const haystack = [...profileTokens].join(" ");
  const titleTokens = tokenize(role.roleTitle);
  const profileOnlyTokens = tokenize(profile);

  let score = 0;

  const titleJoined = titleTokens.join(" ");
  const profileJoined = profileOnlyTokens.join(" ");
  if (titleJoined && profileJoined) {
    if (profileJoined.includes(titleJoined) || titleJoined.includes(profileJoined)) {
      score += 12;
    }
  }

  for (const token of titleTokens) {
    if (profileOnlyTokens.includes(token)) score += 4;
    else if (haystack.includes(token)) score += 1;
  }

  if (role.seniority) {
    for (const token of tokenize(role.seniority)) {
      if (profileOnlyTokens.includes(token)) score += 3;
    }
  }

  const roleLower = `${role.roleTitle} ${role.seniority ?? ""}`.toLowerCase();
  const profileLower = profile.toLowerCase();

  const isSeniorRole = /\b(senior|staff|principal|lead|manager|director|head)\b/.test(roleLower);
  const isJuniorProfile = /\b(intern|internship|trainee|fresher|graduate|entry)\b/.test(profileLower);
  if (isSeniorRole && isJuniorProfile) score -= 8;

  const roleIsManager = /\b(manager|management|director|head)\b/.test(roleLower);
  const profileIsEngineer =
    /\b(engineer|developer|programmer|sde|swe)\b/.test(profileLower) &&
    !/\b(manager|management)\b/.test(profileLower);
  if (roleIsManager && profileIsEngineer) score -= 4;

  const roleIsEngineer = /\b(engineer|developer|programmer|sde|swe|technical)\b/.test(roleLower);
  const profileIsManager =
    /\b(manager|management|director)\b/.test(profileLower) &&
    !/\b(engineer|developer)\b/.test(profileLower);
  if (roleIsEngineer && profileIsManager) score -= 4;

  return score;
}

/**
 * Pick interview questions whose AmbitionBox job profile best matches the JD role.
 * Falls back to the highest-scoring profiles when nothing clears the threshold.
 */
export function selectAmbitionBoxInterviewsForRole(
  items: AmbitionBoxInterviewItem[],
  slug: string,
  role: RoleContext,
  maxResults: number,
): AmbitionBoxSelection {
  const base = ambitionBoxInterviewsUrl(slug);
  if (!role.roleTitle.trim()) {
    const results: AmbitionBoxSearchResult[] = [];
    const profiles = new Set<string>();
    for (const item of items) {
      const question = item.question?.trim();
      if (!question) continue;
      const profile = item.jobProfile?.trim() || "Unknown role";
      const path = item.questionUrl?.trim();
      results.push({
        title: question,
        url: path ? `${base}/${path}` : base,
        snippet: `[${profile}] ${question}`,
        jobProfile: profile,
      });
      profiles.add(profile);
      if (results.length >= maxResults) break;
    }
    return { results, totalScraped: items.length, matchedProfiles: [...profiles] };
  }

  const scored = items
    .map((item) => {
      const question = item.question?.trim();
      if (!question) return null;
      const profile = item.jobProfile?.trim() || "Unknown role";
      const profileUrlTokens = item.jobProfileUrl ? tokenize(item.jobProfileUrl.replace(/-/g, " ")) : [];
      const profileForScore =
        profileUrlTokens.length > 0 ? `${profile} ${profileUrlTokens.join(" ")}` : profile;
      return {
        item,
        question,
        profile,
        score: scoreJobProfileMatch(profileForScore, role),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.score - a.score || a.profile.localeCompare(b.profile));

  if (scored.length === 0) {
    return { results: [], totalScraped: items.length, matchedProfiles: [] };
  }

  const maxScore = scored[0]!.score;
  const threshold = Math.max(3, Math.floor(maxScore * 0.45));
  let picked = scored.filter((row) => row.score >= threshold);
  if (picked.length === 0) {
    picked = scored.slice(0, Math.min(5, scored.length));
  }

  const results: AmbitionBoxSearchResult[] = [];
  const profiles = new Set<string>();

  for (const row of picked) {
    if (results.length >= maxResults) break;
    const path = row.item.questionUrl?.trim();
    const url = path ? `${base}/${path}` : base;
    results.push({
      title: row.question,
      url,
      snippet: `[${row.profile}] ${row.question}`,
      jobProfile: row.profile,
    });
    profiles.add(row.profile);
  }

  return {
    results,
    totalScraped: items.length,
    matchedProfiles: [...profiles],
  };
}
