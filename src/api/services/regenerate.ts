import { editBrief, mergeRegeneratedCategory, recomputeDerived } from "../../core/kitEdits.js";
import { generateCompanyBrief } from "../../core/pipeline/companyBrief.js";
import {
  deriveHiringContext,
  generateQuestionsForCategory,
} from "../../core/pipeline/generateQuestions.js";
import type { Kit, questionCategories } from "../../core/schema/kit.js";
import { ApiError } from "../errors.js";
import type { KitDoc } from "../models/Kit.js";
import { getLlm } from "./llmSingleton.js";

type Category = (typeof questionCategories)[number];

export type RegenerateSection = "schedule" | "company_brief" | "questions";

export interface RegenerateInput {
  section: RegenerateSection;
  /** Required when section is "questions": which category to regenerate. */
  category?: Category;
}

/**
 * Regenerate a single section. The schedule is pure code (no model). The brief
 * and a single question category use the LLM with the research context captured
 * at generation time, so we do not re-crawl. Question regeneration preserves the
 * user's edited questions via mergeRegeneratedCategory.
 */
export async function regenerateSection(kitDoc: KitDoc, input: RegenerateInput): Promise<Kit> {
  const kit = kitDoc.kit!;
  const research = kitDoc.research;

  if (input.section === "schedule") {
    return recomputeDerived(kit, { reschedule: true });
  }

  if (input.section === "company_brief") {
    const pages = research?.briefPages ?? [];
    const brief = await generateCompanyBrief(getLlm(), kit.source.company, pages);
    return {
      ...editBrief(kit, { summary: brief.summary, what_they_do: brief.what_they_do }),
      company_brief: { summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources },
    };
  }

  // section === "questions"
  const category = input.category;
  if (!category) {
    throw new ApiError(400, "VALIDATION_ERROR", "A category is required to regenerate questions");
  }

  const requirements = kit.role.requirements;
  const relevant =
    category === "behavioural"
      ? requirements.filter((r) => r.kind === "behavioural")
      : category === "company-fit"
        ? []
        : requirements.filter((r) => r.kind === "technical" || r.kind === "domain");

  const hiring = deriveHiringContext(research?.hiringText ?? "", research?.discussionText ?? "");
  const companyContext = `${kit.company_brief.summary}\n${kit.company_brief.what_they_do}`.trim();

  const targetCount =
    category === "company-fit" ? 2 : Math.max(category === "behavioural" ? 2 : 3, relevant.length);

  const regenerated = await generateQuestionsForCategory(getLlm(), {
    category,
    requirements: relevant,
    roleTitle: kit.role.title,
    seniority: kit.role.seniority,
    companyContext,
    hiring,
    targetCount,
  });

  return mergeRegeneratedCategory(kit, category, regenerated);
}
