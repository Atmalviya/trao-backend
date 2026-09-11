import { checkCoverage } from "./coverage.js";
import { allocateSchedule } from "./scheduler.js";
import type { Flashcard, Kit, Question, questionCategories } from "./schema/kit.js";

type Category = (typeof questionCategories)[number];

/**
 * The edit/pin state model (the hardest state problem in the brief).
 *
 * Every question and flashcard carries `origin` and `pinned`:
 *   - origin "generated": produced by the model, freely replaceable;
 *   - origin "edited":    a generated item the user changed — must survive;
 *   - origin "manual":    authored by the user by hand — must survive;
 *   - pinned true:        the user explicitly protected it from regeneration.
 *
 * Regenerating a question category replaces ONLY generated-and-unpinned items
 * in that category;
 */

/** Allocate the next stable `${prefix}${n}` id not already used in the kit. */
export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existing) {
    const m = id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

function allQuestionIds(kit: Kit): string[] {
  return kit.questions.map((q) => q.id);
}

/** Recompute the code-owned derived sections after questions change. */
export function recomputeDerived(kit: Kit, opts: { reschedule: boolean }): Kit {
  const report = checkCoverage(kit.role.requirements, kit.questions);
  const coverage = { uncovered_requirement_ids: report.uncovered, passes: kit.coverage.passes };
  const schedule = opts.reschedule
    ? allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available)
    : kit.schedule;
  return { ...kit, coverage, schedule };
}

export interface QuestionPatch {
  prompt?: string;
  answer_outline?: string;
  category?: Category;
  difficulty?: 1 | 2 | 3;
  requirement_ids?: string[];
  pinned?: boolean;
}

/** Edit a question. Any content change marks it "edited" so it survives regen. */
export function editQuestion(kit: Kit, qid: string, patch: QuestionPatch): Kit {
  const questions = kit.questions.map((q) => {
    if (q.id !== qid) return q;
    const changedContent =
      patch.prompt !== undefined ||
      patch.answer_outline !== undefined ||
      patch.category !== undefined ||
      patch.difficulty !== undefined ||
      patch.requirement_ids !== undefined;
    return {
      ...q,
      ...patch,
      origin: changedContent && q.origin === "generated" ? "edited" : q.origin,
    };
  });
  return { ...kit, questions };
}

export interface NewQuestion {
  prompt: string;
  answer_outline: string;
  category: Category;
  difficulty: 1 | 2 | 3;
  requirement_ids: string[];
}

/** Add a hand-written question. */
export function addQuestion(kit: Kit, data: NewQuestion): Kit {
  const q: Question = {
    id: nextId("q", allQuestionIds(kit)),
    requirement_ids: data.requirement_ids,
    category: data.category,
    prompt: data.prompt,
    answer_outline: data.answer_outline,
    difficulty: data.difficulty,
    origin: "manual",
    pinned: false,
  };
  return recomputeDerived({ ...kit, questions: [...kit.questions, q] }, { reschedule: true });
}

export function deleteQuestion(kit: Kit, qid: string): Kit {
  const questions = kit.questions.filter((q) => q.id !== qid);
  return recomputeDerived({ ...kit, questions }, { reschedule: true });
}

/** Reorder questions between categories from a client-provided order. */
export function reorderQuestions(kit: Kit, items: { id: string; category: Category }[]): Kit {
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  if (items.length !== kit.questions.length || items.some((i) => !byId.has(i.id))) {
    throw new Error("Reorder payload must reference exactly the existing question ids");
  }
  const questions = items.map((i) => ({ ...byId.get(i.id)!, category: i.category }));
  return { ...kit, questions };
}

export interface FlashcardPatch {
  front?: string;
  back?: string;
  requirement_ids?: string[];
  pinned?: boolean;
}

export function editFlashcard(kit: Kit, fid: string, patch: FlashcardPatch): Kit {
  const flashcards = kit.flashcards.map((f) => {
    if (f.id !== fid) return f;
    const changedContent =
      patch.front !== undefined || patch.back !== undefined || patch.requirement_ids !== undefined;
    return {
      ...f,
      ...patch,
      origin: changedContent && f.origin === "generated" ? "edited" : f.origin,
    };
  });
  return { ...kit, flashcards };
}

export function addFlashcard(
  kit: Kit,
  data: { front: string; back: string; requirement_ids: string[] },
): Kit {
  const f: Flashcard = {
    id: nextId("f", kit.flashcards.map((x) => x.id)),
    front: data.front,
    back: data.back,
    requirement_ids: data.requirement_ids,
    origin: "manual",
    pinned: false,
  };
  return { ...kit, flashcards: [...kit.flashcards, f] };
}

export function deleteFlashcard(kit: Kit, fid: string): Kit {
  return { ...kit, flashcards: kit.flashcards.filter((f) => f.id !== fid) };
}

export function editBrief(
  kit: Kit,
  patch: { summary?: string; what_they_do?: string },
): Kit {
  return { ...kit, company_brief: { ...kit.company_brief, ...patch } };
}

/**
 * Merge regenerated questions for one category back into the kit,
 * preserving the user's work: generated-and-unpinned questions in that category
 * are dropped and replaced; edited, manual and pinned questions are kept. New
 * questions get fresh non-colliding ids.
 */
export function mergeRegeneratedCategory(
  kit: Kit,
  category: Category,
  regenerated: Omit<Question, "id">[],
): Kit {
  const kept = kit.questions.filter(
    (q) => !(q.category === category && q.origin === "generated" && !q.pinned),
  );

  const usedIds = new Set(kept.map((q) => q.id));
  const added: Question[] = regenerated.map((q) => {
    const id = nextId("q", usedIds);
    usedIds.add(id);
    return { ...q, id, category, origin: "generated", pinned: false };
  });

  // Preserve original ordering position of kept items, append new ones.
  const questions = [...kept, ...added];
  return recomputeDerived({ ...kit, questions }, { reschedule: true });
}
