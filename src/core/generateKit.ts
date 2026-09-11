import { checkCoverage } from "./coverage.js";
import { crawlCompanySite, type CrawlResult } from "./retrieval/crawl.js";
import { searchInterviewDiscussion } from "./retrieval/search.js";
import type { LlmClient } from "./llm/index.js";
import { extractRequirements } from "./pipeline/extractRequirements.js";
import { generateCompanyBrief } from "./pipeline/companyBrief.js";
import {
  deriveHiringContext,
  generateGapQuestions,
  generateQuestions,
} from "./pipeline/generateQuestions.js";
import { generateFlashcards } from "./pipeline/generateFlashcards.js";
import { allocateSchedule } from "./scheduler.js";
import { validateKit, type Kit, type Question, type Requirement } from "./schema/kit.js";

export type StepName =
  | "extract_requirements"
  | "crawl_company_site"
  | "search_public_discussion"
  | "company_brief"
  | "generate_questions"
  | "generate_flashcards"
  | "coverage_check"
  | "allocate_schedule"
  | "validate_kit";

export type StepStatus = "running" | "done" | "skipped" | "failed";

export type StepReporter = (name: StepName, status: StepStatus, note?: string) => void | Promise<void>;

export interface GenerateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface GenerateKitDeps {
  llm: LlmClient;
  allowPrivateNetworks: boolean;
  tavilyApiKey?: string;
  apifyApiToken?: string;
  onStep?: StepReporter;
  /** Max coverage passes including the initial generation. Default 3. */
  maxCoveragePasses?: number;
}

export class KitGenerationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "KitGenerationError";
  }
}

/**
 * The full pipeline. Sequencing is deliberate and responds to what was found:
 * pasted text is extracted with no retrieval; the company site is crawled and a
 * hiring page sought; public discussion is searched; questions are generated
 * per category conditioned on the interview format; then coverage is checked in
 * CODE and drives a bounded gap-fill loop; finally the schedule is allocated in
 * CODE and the kit is validated against Appendix A before returning.
 *
 * Non-fatal problems (unreachable site, no hiring page, no discussion) are
 * recorded and the run continues — a partially-researched case still yields a
 * kit. Only an unrecoverable failure (e.g. requirement extraction fails) throws.
 */
/** Research context captured during generation, persisted so a single section
 *  can later be regenerated without re-crawling the whole site. */
export interface ResearchContext {
  hiringText: string;
  discussionText: string;
  briefPages: { url: string; text: string }[];
}

export async function generateKit(
  input: GenerateKitInput,
  deps: GenerateKitDeps,
): Promise<{ kit: Kit; notes: string[]; research: ResearchContext }> {
  const emit: StepReporter = deps.onStep ?? (() => undefined);
  const maxPasses = deps.maxCoveragePasses ?? 3;
  const notes: string[] = [];
  const fetchOpts = { allowPrivateNetworks: deps.allowPrivateNetworks };

  // 1. Extract requirements from the pasted JD (no retrieval needed here).
  await emit("extract_requirements", "running");
  let extraction;
  try {
    extraction = await extractRequirements(deps.llm, input.jd);
  } catch (err) {
    await emit("extract_requirements", "failed", errMsg(err));
    throw new KitGenerationError("EXTRACTION_FAILED", `Could not extract requirements: ${errMsg(err)}`);
  }
  const mustCount = extraction.requirements.filter((r) => r.priority === "must").length;
  await emit(
    "extract_requirements",
    "done",
    `${extraction.requirements.length} requirements (${mustCount} must)${extraction.notes ? ` — ${extraction.notes}` : ""}`,
  );

  // 2. Crawl the company site. Unreachable → skip and record, not fatal.
  await emit("crawl_company_site", "running");
  let crawl: CrawlResult | null = null;
  try {
    crawl = await crawlCompanySite(input.companyUrl, fetchOpts);
    for (const n of crawl.notes) notes.push(n);
    await emit(
      "crawl_company_site",
      "done",
      `Fetched ${crawl.pagesUsed.length} page(s); hiring page ${crawl.hiringPage ? "found" : "not found"}.`,
    );
  } catch (err) {
    notes.push(`Company site could not be crawled: ${errMsg(err)}`);
    await emit("crawl_company_site", "skipped", errMsg(err));
  }

  const companyName = deriveCompanyName(input.companyUrl, crawl, extraction.title);

  // 3. Search public discussion of the interview process.
  await emit("search_public_discussion", "running");
  const discussion = await searchInterviewDiscussion(companyName, {
    companyUrl: input.companyUrl,
    roleTitle: extraction.title,
    seniority: extraction.seniority,
    apifyApiToken: deps.apifyApiToken,
    tavilyApiKey: deps.tavilyApiKey,
  }).catch(() => ({ results: [], source: "none" as const, note: "Search failed." }));
  notes.push(discussion.note);
  await emit(
    "search_public_discussion",
    discussion.source === "none" ? "skipped" : "done",
    discussion.note,
  );

  // 4. Company brief from the fetched pages (honest when little was found).
  await emit("company_brief", "running");
  const briefPages = crawl
    ? dedupePages([
        crawl.aboutPage ? { url: crawl.aboutPage.url, text: crawl.aboutPage.text } : null,
        crawl.hiringPage ? { url: crawl.hiringPage.url, text: crawl.hiringPage.text } : null,
        ...crawl.pages.slice(0, 2).map((p) => ({ url: p.url, text: p.text })),
      ])
    : [];
  const brief = await generateCompanyBrief(deps.llm, companyName, briefPages);
  const companyContext = `${brief.summary}\n${brief.what_they_do}`.trim();
  await emit("company_brief", briefPages.length === 0 ? "skipped" : "done", brief.summary.slice(0, 120));

  // 5. Questions — separate call per category, conditioned on hiring format.
  await emit("generate_questions", "running");
  const discussionText = discussion.results
    .map((r) => `${r.title}: ${r.snippet}`)
    .join("\n")
    .slice(0, 3_000);
  const hiring = deriveHiringContext(crawl?.hiringPage?.text ?? "", discussionText);
  const questionParams = {
    requirements: extraction.requirements,
    roleTitle: extraction.title,
    seniority: extraction.seniority,
    companyContext,
    hiring,
  };
  let questions: Question[] = await generateQuestions(deps.llm, questionParams);
  await emit(
    "generate_questions",
    "done",
    `${questions.length} questions${hiring.hasSystemDesignRound ? " (weighted for a system-design round)" : ""}.`,
  );

  // 6. Flashcards.
  await emit("generate_flashcards", "running");
  const flashcards = await generateFlashcards(deps.llm, extraction.requirements, companyContext);
  await emit("generate_flashcards", "done", `${flashcards.length} flashcards.`);

  // 7. Coverage check (CODE) + bounded gap-fill loop (the mandated second pass).
  await emit("coverage_check", "running");
  let passes = 1;
  let report = checkCoverage(extraction.requirements, questions);
  while (report.uncovered.length > 0 && passes < maxPasses) {
    const uncoveredReqs = extraction.requirements.filter((r) => report.uncovered.includes(r.id));
    const gap = await generateGapQuestions(deps.llm, uncoveredReqs, questionParams);
    if (gap.length === 0) break; // model produced nothing new; stop looping
    let idx = questions.length;
    questions = questions.concat(gap.map((q) => ({ ...q, id: `q${++idx}` })));
    passes++;
    report = checkCoverage(extraction.requirements, questions);
  }
  if (report.uncoveredMust.length > 0) {
    notes.push(
      `After ${passes} pass(es), ${report.uncoveredMust.length} must-have requirement(s) remain uncovered: ${report.uncoveredMust.join(", ")}.`,
    );
  }
  await emit(
    "coverage_check",
    report.uncoveredMust.length > 0 ? "skipped" : "done",
    `passes=${passes}; uncovered must-haves=${report.uncoveredMust.length}.`,
  );

  // 8. Schedule allocation (CODE) across exactly the requested days.
  await emit("allocate_schedule", "running");
  const schedule = allocateSchedule(questions, extraction.requirements, input.days);
  await emit("allocate_schedule", "done", `${schedule.days.length} day(s).`);

  // 9. Assemble + validate against Appendix A.
  await emit("validate_kit", "running");
  const candidate: Kit = {
    source: {
      company: companyName,
      company_url: input.companyUrl,
      role: extraction.title,
      location: "",
      jd_chars: extraction.jdChars,
      researched_at: new Date().toISOString(),
      pages_used: crawl?.pagesUsed ?? [],
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
    },
    role: {
      title: extraction.title,
      seniority: extraction.seniority,
      responsibilities: extraction.responsibilities,
      requirements: extraction.requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: report.uncovered,
      passes,
    },
  };

  const { kit, issues } = validateKit(candidate);
  if (!kit) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    await emit("validate_kit", "failed", detail);
    throw new KitGenerationError("INVALID_KIT", `Generated kit failed validation: ${detail}`);
  }
  await emit("validate_kit", "done");

  return {
    kit,
    notes,
    research: {
      hiringText: crawl?.hiringPage?.text ?? "",
      discussionText,
      briefPages,
    },
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dedupePages(
  pages: ({ url: string; text: string } | null)[],
): { url: string; text: string }[] {
  const seen = new Set<string>();
  const out: { url: string; text: string }[] = [];
  for (const p of pages) {
    if (!p || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  return out;
}

/** Derive a display company name from the crawled homepage title or the URL. */
function deriveCompanyName(url: string, crawl: CrawlResult | null, roleTitle: string): string {
  const homeTitle = crawl?.pages[0]?.title ?? "";
  if (homeTitle) {
    // "Acme Robotics — Autonomous Warehouse Systems" → "Acme Robotics"
    const brand = homeTitle.split(/[|–—-]/)[0]?.trim();
    if (brand && brand.length >= 2) return brand;
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] ?? host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return roleTitle || "the company";
  }
}
