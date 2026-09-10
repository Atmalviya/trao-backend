import { z } from "zod";

/**
 * The kit structure from Appendix A of the brief. Field names are exact and
 * must not change — the automated evaluation matches against them.
 *
 * Documented extension (allowed by the brief): questions and flashcards carry
 * `origin` and `pinned`, which is how the builder preserves user edits across
 * regenerations. `origin: "generated"` items are replaceable; `edited`,
 * `manual` or pinned items survive a section regeneration.
 */

export const requirementKinds = ["technical", "behavioural", "domain"] as const;
export const requirementPriorities = ["must", "nice"] as const;
export const questionCategories = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;
export const itemOrigins = ["generated", "edited", "manual"] as const;

const urlString = z.string();
const intMinutes = z.number().int().nonnegative();

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(requirementKinds),
  priority: z.enum(requirementPriorities),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(questionCategories),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  // extension fields (see module doc)
  origin: z.enum(itemOrigins).default("generated"),
  pinned: z.boolean().default(false),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  origin: z.enum(itemOrigins).default("generated"),
  pinned: z.boolean().default(false),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: intMinutes,
});

export const kitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: urlString,
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().nonnegative(),
    researched_at: z.string(), // ISO timestamp
    pages_used: z.array(urlString),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(urlString),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(requirementSchema),
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({
    days_available: z.number().int().positive(),
    days: z.array(scheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().nonnegative(),
  }),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Kit = z.infer<typeof kitSchema>;

export interface KitValidationIssue {
  path: string;
  message: string;
}

/**
 * Structural validation plus the referential rules Appendix A states:
 * ids are stable/unique within a kit, every question's requirement_ids point
 * at real requirements, and every schedule question_id points at a real
 * question. Returns issues rather than throwing so callers (API, batch CLI,
 * pipeline retry logic) can decide what a failure means.
 */
export function validateKit(candidate: unknown): { kit?: Kit; issues: KitValidationIssue[] } {
  const parsed = kitSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  const kit = parsed.data;
  const issues: KitValidationIssue[] = [];

  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));
  const flashcardIds = new Set(kit.flashcards.map((f) => f.id));

  for (const [name, ids, list] of [
    ["role.requirements", requirementIds, kit.role.requirements],
    ["questions", questionIds, kit.questions],
    ["flashcards", flashcardIds, kit.flashcards],
  ] as const) {
    if (ids.size !== list.length) {
      issues.push({ path: name, message: "ids must be unique within the kit" });
    }
  }

  kit.questions.forEach((q, qi) => {
    for (const rid of q.requirement_ids) {
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `questions.${qi}.requirement_ids`,
          message: `references unknown requirement "${rid}"`,
        });
      }
    }
  });

  kit.flashcards.forEach((f, fi) => {
    for (const rid of f.requirement_ids) {
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `flashcards.${fi}.requirement_ids`,
          message: `references unknown requirement "${rid}"`,
        });
      }
    }
  });

  kit.schedule.days.forEach((d, di) => {
    for (const qid of d.question_ids) {
      if (!questionIds.has(qid)) {
        issues.push({
          path: `schedule.days.${di}.question_ids`,
          message: `references unknown question "${qid}"`,
        });
      }
    }
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issues.push({
      path: "schedule.days",
      message: `schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`,
    });
  }

  return issues.length > 0 ? { issues } : { kit, issues: [] };
}
