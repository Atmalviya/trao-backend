import { describe, expect, it } from "vitest";
import {
  addQuestion,
  deleteQuestion,
  editQuestion,
  mergeRegeneratedCategory,
  nextId,
  reorderQuestions,
} from "../src/core/kitEdits.js";
import { validateKit, type Kit, type Question } from "../src/core/schema/kit.js";

function baseKit(): Kit {
  const q = (id: string, over: Partial<Question> = {}): Question => ({
    id,
    requirement_ids: ["r1"],
    category: "technical",
    prompt: `prompt ${id}`,
    answer_outline: "outline",
    difficulty: 2,
    origin: "generated",
    pinned: false,
    ...over,
  });
  return {
    source: { company: "Acme", company_url: "https://acme.test", role: "Eng", location: "", jd_chars: 100, researched_at: "2026-01-01T00:00:00Z", pages_used: [] },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: {
      title: "Eng",
      seniority: "senior",
      responsibilities: [],
      requirements: [{ id: "r1", text: "React", kind: "technical", priority: "must" }],
    },
    questions: [
      q("q1"),
      q("q2", { origin: "edited", prompt: "user edited this" }),
      q("q3", { origin: "generated", pinned: true, prompt: "user pinned this" }),
      q("q4", { origin: "manual", prompt: "user wrote this" }),
    ],
    flashcards: [],
    schedule: { days_available: 2, days: [
      { day: 1, focus: "f", question_ids: ["q1", "q2"], minutes: 50 },
      { day: 2, focus: "f", question_ids: ["q3", "q4"], minutes: 50 },
    ] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("nextId", () => {
  it("returns the next non-colliding numeric id", () => {
    expect(nextId("q", ["q1", "q2", "q7"])).toBe("q8");
    expect(nextId("q", [])).toBe("q1");
  });
});

describe("editQuestion", () => {
  it("marks a generated question as edited when content changes", () => {
    const kit = editQuestion(baseKit(), "q1", { prompt: "new" });
    expect(kit.questions.find((q) => q.id === "q1")!.origin).toBe("edited");
  });
  it("does not relabel when only toggling pin", () => {
    const kit = editQuestion(baseKit(), "q1", { pinned: true });
    const q1 = kit.questions.find((q) => q.id === "q1")!;
    expect(q1.origin).toBe("generated");
    expect(q1.pinned).toBe(true);
  });
});

describe("mergeRegeneratedCategory (regeneration preserves user work)", () => {
  it("replaces only generated-unpinned questions, keeping edited/manual/pinned", () => {
    const before = baseKit();
    const regenerated = [
      { requirement_ids: ["r1"], category: "technical" as const, prompt: "fresh 1", answer_outline: "o", difficulty: 2 as const, origin: "generated" as const, pinned: false },
      { requirement_ids: ["r1"], category: "technical" as const, prompt: "fresh 2", answer_outline: "o", difficulty: 3 as const, origin: "generated" as const, pinned: false },
    ];
    const after = mergeRegeneratedCategory(before, "technical", regenerated);
    const prompts = after.questions.map((q) => q.prompt);

    // q1 (generated, unpinned) was dropped; the others survived.
    expect(prompts).not.toContain("prompt q1");
    expect(prompts).toContain("user edited this"); // q2 edited
    expect(prompts).toContain("user pinned this"); // q3 pinned
    expect(prompts).toContain("user wrote this"); // q4 manual
    expect(prompts).toContain("fresh 1");
    expect(prompts).toContain("fresh 2");

    // New ids do not collide and the kit stays valid.
    const ids = after.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateKit(after).issues).toEqual([]);
  });

  it("leaves questions in other categories untouched", () => {
    const before = baseKit();
    before.questions.push({ id: "q5", requirement_ids: [], category: "behavioural", prompt: "beh", answer_outline: "o", difficulty: 1, origin: "generated", pinned: false });
    const after = mergeRegeneratedCategory(before, "technical", []);
    expect(after.questions.find((q) => q.id === "q5")).toBeDefined();
  });
});

describe("add/delete/reorder keep the kit valid", () => {
  it("adds a manual question and reschedules so the schedule stays valid", () => {
    const after = addQuestion(baseKit(), { prompt: "p", answer_outline: "o", category: "technical", difficulty: 1, requirement_ids: ["r1"] });
    expect(after.questions.some((q) => q.origin === "manual" && q.prompt === "p")).toBe(true);
    expect(validateKit(after).issues).toEqual([]);
  });

  it("deletes a question without leaving dangling schedule references", () => {
    const after = deleteQuestion(baseKit(), "q1");
    expect(after.questions.some((q) => q.id === "q1")).toBe(false);
    expect(validateKit(after).issues).toEqual([]);
  });

  it("reorders and moves categories while preserving ids", () => {
    const before = baseKit();
    const after = reorderQuestions(before, [
      { id: "q4", category: "technical" },
      { id: "q3", category: "behavioural" },
      { id: "q2", category: "technical" },
      { id: "q1", category: "technical" },
    ]);
    expect(after.questions[0]!.id).toBe("q4");
    expect(after.questions.find((q) => q.id === "q3")!.category).toBe("behavioural");
    expect(after.schedule.days.flatMap((d) => d.question_ids)).toEqual(["q4", "q3", "q2", "q1"]);
    expect(JSON.stringify(after.schedule.days)).not.toBe(JSON.stringify(before.schedule.days));
  });

  it("rejects a reorder payload that does not match existing ids", () => {
    expect(() => reorderQuestions(baseKit(), [{ id: "q1", category: "technical" }])).toThrow();
  });
});
