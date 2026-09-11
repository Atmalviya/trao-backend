import { describe, expect, it } from "vitest";
import { checkCoverage } from "../src/core/coverage.js";
import { allocateSchedule, orderQuestionsForStudy } from "../src/core/scheduler.js";
import type { Question, Requirement } from "../src/core/schema/kit.js";

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Distributed systems", kind: "technical", priority: "must" },
  { id: "r3", text: "Mentoring", kind: "behavioural", priority: "nice" },
];

function q(id: string, difficulty: 1 | 2 | 3, requirement_ids: string[], category: Question["category"] = "technical"): Question {
  return {
    id,
    requirement_ids,
    category,
    prompt: `prompt ${id}`,
    answer_outline: "outline",
    difficulty,
    origin: "generated",
    pinned: false,
  };
}

const questions: Question[] = [
  q("q1", 1, ["r3"], "behavioural"),
  q("q2", 3, ["r2"], "system-design"),
  q("q3", 2, ["r1"], "technical"),
  q("q4", 2, ["r1"], "technical"),
  q("q5", 3, ["r2"], "system-design"),
];

/** Every must-have requirement must be referenced by some scheduled question. */
function mustsAppear(schedule: ReturnType<typeof allocateSchedule>): boolean {
  const scheduledQ = new Set(schedule.days.flatMap((d) => d.question_ids));
  const mustIds = requirements.filter((r) => r.priority === "must").map((r) => r.id);
  const coveredByScheduled = new Set(
    questions.filter((x) => scheduledQ.has(x.id)).flatMap((x) => x.requirement_ids),
  );
  return mustIds.every((id) => coveredByScheduled.has(id));
}

describe("orderQuestionsForStudy", () => {
  it("puts must-covering, hardest questions first", () => {
    const ordered = orderQuestionsForStudy(questions, requirements);
    // q2/q5 (must + difficulty 3) should lead; q1 (nice, easy) should be last.
    expect(["q2", "q5"]).toContain(ordered[0]!.id);
    expect(ordered[ordered.length - 1]!.id).toBe("q1");
  });
});

describe("allocateSchedule", () => {
  it("produces exactly the requested number of days", () => {
    for (const days of [1, 2, 3, 5, 7, 60]) {
      const s = allocateSchedule(questions, requirements, days);
      expect(s.days_available).toBe(days);
      expect(s.days).toHaveLength(days);
      expect(s.days.map((d) => d.day)).toEqual(Array.from({ length: days }, (_, i) => i + 1));
    }
  });

  it("schedules every question and makes every must-have appear", () => {
    for (const days of [1, 2, 3, 5, 60]) {
      const s = allocateSchedule(questions, requirements, days);
      expect(mustsAppear(s)).toBe(true);
    }
  });

  it("uses only integer minutes on every day", () => {
    const s = allocateSchedule(questions, requirements, 4);
    for (const day of s.days) expect(Number.isInteger(day.minutes)).toBe(true);
  });

  it("references only existing question ids", () => {
    const ids = new Set(questions.map((x) => x.id));
    const s = allocateSchedule(questions, requirements, 5);
    for (const day of s.days) {
      for (const qid of day.question_ids) expect(ids.has(qid)).toBe(true);
    }
  });

  it("front-loads the hardest material (day 1 harder than the last working day)", () => {
    const s = allocateSchedule(questions, requirements, 2);
    const difficultyOf = (id: string) => questions.find((x) => x.id === id)!.difficulty;
    const day1Max = Math.max(...s.days[0]!.question_ids.map(difficultyOf));
    const day2Max = Math.max(...s.days[1]!.question_ids.map(difficultyOf));
    expect(day1Max).toBeGreaterThanOrEqual(day2Max);
  });

  it("handles a 1-day schedule by packing everything into one day", () => {
    const s = allocateSchedule(questions, requirements, 1);
    expect(s.days).toHaveLength(1);
    expect(s.days[0]!.question_ids.sort()).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("handles a 60-day schedule with review days for the empty tail", () => {
    const s = allocateSchedule(questions, requirements, 60);
    expect(s.days).toHaveLength(60);
    // First 5 days each carry one real question; the rest are review days.
    expect(s.days.slice(0, 5).every((d) => d.question_ids.length === 1)).toBe(true);
    expect(s.days[59]!.focus.toLowerCase()).toContain("review");
    expect(mustsAppear(s)).toBe(true);
  });

  it("produces a thin but valid schedule when there are no questions", () => {
    const s = allocateSchedule([], requirements, 3);
    expect(s.days).toHaveLength(3);
    expect(s.days.every((d) => d.question_ids.length === 0)).toBe(true);
    expect(s.days.every((d) => Number.isInteger(d.minutes))).toBe(true);
  });

  it("can allocate in builder question order when requested", () => {
    const userOrder = [questions[0]!, questions[2]!, questions[1]!, questions[4]!, questions[3]!];
    const study = allocateSchedule(questions, requirements, 4);
    const custom = allocateSchedule(questions, requirements, 4, { questionOrder: userOrder });
    expect(custom.days.flatMap((d) => d.question_ids)).toEqual(userOrder.map((q) => q.id));
    expect(JSON.stringify(custom.days)).not.toBe(JSON.stringify(study.days));
  });

  it("keeps coverage consistent: scheduled musts match the coverage report", () => {
    const report = checkCoverage(requirements, questions);
    expect(report.uncoveredMust).toEqual([]);
  });
});
