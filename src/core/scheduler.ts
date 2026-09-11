import type { Question, Requirement, ScheduleDay } from "./schema/kit.js";

/** Minutes budgeted per question by difficulty. */
const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 15, 2: 25, 3: 40 };
const REVIEW_DAY_MINUTES = 30;

function questionMinutes(q: Question): number {
  return MINUTES_BY_DIFFICULTY[q.difficulty] ?? 25;
}

const CATEGORY_FOCUS: Record<string, string> = {
  technical: "Technical deep-dive",
  "system-design": "System design",
  behavioural: "Behavioural & collaboration",
  "company-fit": "Company fit & motivation",
};

/** Order questions for study: those covering a must-have first, then hardest first, so the highest-priority and hardest material lands earliest. */
export function orderQuestionsForStudy(
  questions: Question[],
  requirements: Requirement[],
): Question[] {
  const mustIds = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const coversMust = (q: Question) => q.requirement_ids.some((id) => mustIds.has(id));

  return [...questions].sort((a, b) => {
    const am = coversMust(a) ? 0 : 1;
    const bm = coversMust(b) ? 0 : 1;
    if (am !== bm) return am - bm;
    if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
    return a.id.localeCompare(b.id);
  });
}

/** Split an ordered list into `parts` contiguous chunks of near-equal size. */
function chunkEvenly<T>(items: T[], parts: number): T[][] {
  const chunks: T[][] = Array.from({ length: parts }, () => []);
  const base = Math.floor(items.length / parts);
  const remainder = items.length % parts;
  let idx = 0;
  for (let d = 0; d < parts; d++) {
    // front days get the extra item when it doesn't divide evenly — combined with a hard-first ordering this keeps the heaviest load early
    const size = base + (d < remainder ? 1 : 0);
    chunks[d] = items.slice(idx, idx + size);
    idx += size;
  }
  return chunks;
}

function focusFor(questions: Question[]): string {
  if (questions.length === 0) return "Review & consolidation";
  const counts: Record<string, number> = {};
  for (const q of questions) counts[q.category] = (counts[q.category] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "technical";
  return CATEGORY_FOCUS[top] ?? "Focused practice";
}

/** Allocate questions across exactly `daysAvailable` days. */
export function allocateSchedule(
  questions: Question[],
  requirements: Requirement[],
  daysAvailable: number,
): { days_available: number; days: ScheduleDay[] } {
  const days = Math.max(1, Math.floor(daysAvailable));
  const ordered = orderQuestionsForStudy(questions, requirements);

  const result: ScheduleDay[] = [];

  if (ordered.length === 0) {
    // still produce the requested number of days
    for (let d = 1; d <= days; d++) {
      result.push({
        day: d,
        focus: "Review the role and company brief",
        question_ids: [],
        minutes: REVIEW_DAY_MINUTES,
      });
    }
    return { days_available: days, days: result };
  }

  if (ordered.length >= days) {
    // contiguous hard-first chunks, one per day
    const chunks = chunkEvenly(ordered, days);
    chunks.forEach((chunk, i) => {
      result.push({
        day: i + 1,
        focus: focusFor(chunk),
        question_ids: chunk.map((q) => q.id),
        minutes: chunk.reduce((sum, q) => sum + questionMinutes(q), 0),
      });
    });
    return { days_available: days, days: result };
  }

  // one question on each of the first N days
  ordered.forEach((q, i) => {
    result.push({
      day: i + 1,
      focus: focusFor([q]),
      question_ids: [q.id],
      minutes: questionMinutes(q),
    });
  });

  const reviewPool = ordered.slice(0, Math.min(3, ordered.length)).map((q) => q.id);
  for (let d = ordered.length + 1; d <= days; d++) {
    result.push({
      day: d,
      focus: "Spaced review of the hardest material",
      question_ids: reviewPool,
      minutes: REVIEW_DAY_MINUTES,
    });
  }

  return { days_available: days, days: result };
}
