import { describe, expect, it } from "vitest";
import { validateKit, type Kit } from "../src/core/schema/kit.js";

/** Minimal fully-valid kit used as the baseline for each case. */
function validKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.test",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: "2026-09-10T10:00:00Z",
      pages_used: ["https://acme.test/careers"],
    },
    company_brief: {
      summary: "Acme builds rockets.",
      what_they_do: "Rocket logistics.",
      sources: ["https://acme.test"],
    },
    role: {
      title: "Senior Backend Engineer",
      seniority: "senior",
      responsibilities: ["Build APIs"],
      requirements: [
        { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentors junior engineers", kind: "behavioural", priority: "nice" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain the Node.js event loop.",
        answer_outline: "Phases, microtasks, blocking pitfalls.",
        difficulty: 2,
        origin: "generated",
        pinned: false,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "What is the event loop?",
        back: "The mechanism that schedules async callbacks.",
        requirement_ids: ["r1"],
        origin: "generated",
        pinned: false,
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Node.js internals", question_ids: ["q1"], minutes: 60 },
        { day: 2, focus: "Review", question_ids: [], minutes: 30 },
      ],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 2 },
  };
}

describe("validateKit", () => {
  it("accepts a fully valid kit", () => {
    const { kit, issues } = validateKit(validKit());
    expect(issues).toEqual([]);
    expect(kit).toBeDefined();
  });

  it("rejects a kit missing a required field", () => {
    const broken = validKit() as any;
    delete broken.company_brief;
    const { issues } = validateKit(broken);
    expect(issues.some((i) => i.path.startsWith("company_brief"))).toBe(true);
  });

  it("rejects an unknown requirement kind or priority", () => {
    const broken = validKit();
    (broken.role.requirements[0] as any).priority = "required";
    expect(validateKit(broken).issues.length).toBeGreaterThan(0);
  });

  it("rejects non-integer minutes and out-of-range difficulty", () => {
    const floatMinutes = validKit();
    floatMinutes.schedule.days[0]!.minutes = 62.5;
    expect(validateKit(floatMinutes).issues.length).toBeGreaterThan(0);

    const badDifficulty = validKit();
    badDifficulty.questions[0]!.difficulty = 5;
    expect(validateKit(badDifficulty).issues.length).toBeGreaterThan(0);
  });

  it("rejects a question referencing a requirement that does not exist", () => {
    const broken = validKit();
    broken.questions[0]!.requirement_ids = ["r99"];
    const { issues } = validateKit(broken);
    expect(issues[0]?.message).toContain("r99");
  });

  it("rejects a schedule referencing a question that does not exist", () => {
    const broken = validKit();
    broken.schedule.days[0]!.question_ids = ["q99"];
    const { issues } = validateKit(broken);
    expect(issues[0]?.message).toContain("q99");
  });

  it("rejects duplicate ids within a section", () => {
    const broken = validKit();
    broken.role.requirements.push({ ...broken.role.requirements[0]! });
    const { issues } = validateKit(broken);
    expect(issues.some((i) => i.message.includes("unique"))).toBe(true);
  });

  it("rejects a schedule whose day count does not match days_available", () => {
    const broken = validKit();
    broken.schedule.days_available = 5;
    const { issues } = validateKit(broken);
    expect(issues.some((i) => i.path === "schedule.days")).toBe(true);
  });
});
