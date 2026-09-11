import { z } from "zod";
import type { LlmClient } from "../llm/index.js";
import { questionCategories, type Question, type Requirement } from "../schema/kit.js";
import { clamp, INJECTION_GUARD, wrapUntrusted } from "./prompt.js";

type Category = (typeof questionCategories)[number];

/** LLM output per category — no ids/category; code fills those in. */
const categoryOutputSchema = z.object({
  questions: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      prompt: z.string(),
      answer_outline: z.string(),
      difficulty: z.number().int().min(1).max(3),
    }),
  ),
});

export interface HiringContext {
  /** Cleaned text from the hiring/interview page, if one was found. */
  hiringText: string;
  /** Snippets from public discussion of the interview process. */
  discussionText: string;
  hasSystemDesignRound: boolean;
  hasTakeHome: boolean;
}

/** Detect interview-format signals in code so we can steer question mix. */
export function deriveHiringContext(hiringText: string, discussionText: string): HiringContext {
  const blob = `${hiringText}\n${discussionText}`.toLowerCase();
  return {
    hiringText,
    discussionText,
    hasSystemDesignRound: /system design|architecture (interview|round)|design interview/.test(blob),
    hasTakeHome: /take-home|take home|home assignment|coding exercise/.test(blob),
  };
}

const CATEGORY_INSTRUCTIONS: Record<Category, string> = {
  technical:
    "Generate technical interview questions that probe concrete skills, tools and " +
    "languages. Each question must map to the specific requirement(s) it tests via " +
    "requirement_ids. Prefer depth over trivia.",
  behavioural:
    "Generate behavioural questions about collaboration, ownership, mentoring, conflict " +
    "and communication. Ask for concrete past examples (STAR-style). Map each to the " +
    "requirement(s) it addresses.",
  "system-design":
    "Generate system design questions appropriate to the seniority and domain. Focus on " +
    "trade-offs, scale, failure modes and data flow. Map to the technical/domain " +
    "requirement(s) they exercise.",
  "company-fit":
    "Generate company-fit and motivation questions grounded in what this company does and " +
    "how it works. These may reference requirements where relevant but need not.",
};

interface CategoryArgs {
  category: Category;
  requirements: Requirement[];
  roleTitle: string;
  seniority: string;
  companyContext: string;
  hiring: HiringContext;
  targetCount: number;
}

function systemFor(category: Category): string {
  return [
    `You write ${category} interview questions for interview preparation.`,
    INJECTION_GUARD,
    "",
    CATEGORY_INSTRUCTIONS[category],
    "",
    "Rules:",
    "- Only use requirement ids from the provided list; never invent ids.",
    "- Ensure every requirement in the list is covered by at least one question.",
    "- difficulty is an integer 1 (easy) to 3 (hard).",
    "- Do not fabricate facts about the company; ground fit questions in the given context.",
  ].join("\n");
}

/** Generate questions for one category (one deliberate call). */
export async function generateQuestionsForCategory(
  llm: LlmClient,
  args: CategoryArgs,
): Promise<Omit<Question, "id">[]> {
  if (args.targetCount <= 0) return [];

  const reqList = args.requirements
    .map((r) => `- ${r.id} [${r.priority}/${r.kind}]: ${r.text}`)
    .join("\n");

  const hiringBlock =
    args.hiring.hiringText || args.hiring.discussionText
      ? wrapUntrusted(
          "KNOWN INTERVIEW PROCESS (for weighting the questions)",
          clamp(`${args.hiring.hiringText}\n${args.hiring.discussionText}`, 3_000),
        )
      : "No specific interview-process information was found for this company.";

  const prompt = [
    `Role: ${args.roleTitle} (${args.seniority}).`,
    `Produce about ${args.targetCount} ${args.category} questions.`,
    args.requirements.length > 0
      ? `Requirements to cover (use these ids in requirement_ids):\n${reqList}`
      : "There are no specific requirements in this category; produce general questions and leave requirement_ids empty.",
    args.companyContext ? `Company context:\n${clamp(args.companyContext, 1_500)}` : "",
    hiringBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await llm.generate({
    system: systemFor(args.category),
    prompt,
    schema: categoryOutputSchema,
    label: `generate_questions:${args.category}`,
  });

  const validIds = new Set(args.requirements.map((r) => r.id));
  return out.questions.map((q) => ({
    // Drop any hallucinated requirement ids defensively.
    requirement_ids: q.requirement_ids.filter((id) => validIds.has(id)),
    category: args.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: Math.min(3, Math.max(1, q.difficulty)) as 1 | 2 | 3,
    origin: "generated" as const,
    pinned: false,
  }));
}

export interface GenerateQuestionsParams {
  requirements: Requirement[];
  roleTitle: string;
  seniority: string;
  companyContext: string;
  hiring: HiringContext;
}

/**
 * Orchestrate question generation as separate per-category calls (the brief
 * requires categories to be generated separately, not from one prompt). The
 * question mix is conditioned in code on the interview-format signals: a
 * company with a system-design round gets more design questions. Stable q-ids
 * are assigned here, across all categories.
 */
export async function generateQuestions(
  llm: LlmClient,
  params: GenerateQuestionsParams,
): Promise<Question[]> {
  const technicalReqs = params.requirements.filter(
    (r) => r.kind === "technical" || r.kind === "domain",
  );
  const behaviouralReqs = params.requirements.filter((r) => r.kind === "behavioural");

  const isSenior = /senior|staff|principal|lead/i.test(`${params.seniority} ${params.roleTitle}`);
  const systemDesignTarget = params.hiring.hasSystemDesignRound ? 3 : isSenior ? 2 : 1;

  const base = {
    roleTitle: params.roleTitle,
    seniority: params.seniority,
    companyContext: params.companyContext,
    hiring: params.hiring,
  };

  // Sequential (not parallel) to stay within the shared LLM rate window.
  const technical = await generateQuestionsForCategory(llm, {
    ...base,
    category: "technical",
    requirements: technicalReqs,
    targetCount: Math.max(3, technicalReqs.length),
  });
  const behavioural = await generateQuestionsForCategory(llm, {
    ...base,
    category: "behavioural",
    requirements: behaviouralReqs,
    targetCount: Math.max(2, behaviouralReqs.length),
  });
  const systemDesign = await generateQuestionsForCategory(llm, {
    ...base,
    category: "system-design",
    requirements: technicalReqs,
    targetCount: systemDesignTarget,
  });
  const companyFit = await generateQuestionsForCategory(llm, {
    ...base,
    category: "company-fit",
    requirements: [],
    targetCount: 2,
  });

  const all = [...technical, ...behavioural, ...systemDesign, ...companyFit];
  return all.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

/**
 * Targeted generation for the coverage loop: produce questions for a set of
 * still-uncovered requirements, routed to the right category by kind. Ids are
 * assigned by the caller (it knows the existing max index).
 */
export async function generateGapQuestions(
  llm: LlmClient,
  uncovered: Requirement[],
  params: GenerateQuestionsParams,
): Promise<Omit<Question, "id">[]> {
  if (uncovered.length === 0) return [];
  const technical = uncovered.filter((r) => r.kind === "technical" || r.kind === "domain");
  const behavioural = uncovered.filter((r) => r.kind === "behavioural");

  const base = {
    roleTitle: params.roleTitle,
    seniority: params.seniority,
    companyContext: params.companyContext,
    hiring: params.hiring,
  };

  const out: Omit<Question, "id">[] = [];
  if (technical.length > 0) {
    out.push(
      ...(await generateQuestionsForCategory(llm, {
        ...base,
        category: "technical",
        requirements: technical,
        targetCount: technical.length,
      })),
    );
  }
  if (behavioural.length > 0) {
    out.push(
      ...(await generateQuestionsForCategory(llm, {
        ...base,
        category: "behavioural",
        requirements: behavioural,
        targetCount: behavioural.length,
      })),
    );
  }
  return out;
}
