import { z } from "zod";
import type { LlmClient } from "../llm/index.js";
import { clamp, INJECTION_GUARD, wrapUntrusted } from "./prompt.js";

const briefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  /** True when the provided pages contained little to go on. */
  low_information: z.boolean().optional(),
});

export interface CompanyPageInput {
  url: string;
  text: string;
}

export interface CompanyBriefResult {
  summary: string;
  what_they_do: string;
  sources: string[];
}

const SYSTEM = [
  "You write a short, factual company brief to help someone prepare for an interview.",
  INJECTION_GUARD,
  "",
  "Rules:",
  "- Use ONLY facts present in the provided pages. Do not invent funding, head",
  "  count, customers, or history that is not stated.",
  "- If the pages contain little real information, say so plainly in the summary",
  "  (e.g. 'Limited public information was available.') and set low_information",
  "  to true. An honest thin brief is required over a fabricated confident one.",
  "- Keep 'summary' to 2-4 sentences and 'what_they_do' focused on the product",
  "  and who it is for.",
].join("\n");

/**
 * Step: company brief. Sources are set in code from the pages actually used —
 * the model does not get to cite pages it was not given.
 */
export async function generateCompanyBrief(
  llm: LlmClient,
  companyName: string,
  pages: CompanyPageInput[],
): Promise<CompanyBriefResult> {
  const sources = pages.map((p) => p.url);

  if (pages.length === 0) {
    // Nothing was retrievable — return an honest brief without calling the LLM.
    return {
      summary: `Limited public information was available for ${companyName || "this company"}. The company website could not be retrieved, so this brief is intentionally sparse.`,
      what_they_do: "Not enough information was retrieved to describe what they do.",
      sources,
    };
  }

  const corpus = pages
    .map((p) => wrapUntrusted(`PAGE ${p.url}`, clamp(p.text, 4_000)))
    .join("\n\n");

  const out = await llm.generate({
    system: SYSTEM,
    prompt: [
      `Write a company brief for: ${companyName || "(name unknown)"}.`,
      "Base it only on these fetched pages:",
      corpus,
    ].join("\n\n"),
    schema: briefSchema,
    label: "company_brief",
  });

  return { summary: out.summary, what_they_do: out.what_they_do, sources };
}
