import { describe, expect, it } from "vitest";
import { regenerateSection } from "../src/api/services/regenerate.js";
import type { KitDoc } from "../src/api/models/Kit.js";
import type { Kit } from "../src/core/schema/kit.js";

function sampleKit(): Kit {
  const q = (id: string, difficulty: 1 | 2 | 3): Kit["questions"][number] => ({
    id,
    requirement_ids: ["r1"],
    category: "technical",
    prompt: `prompt ${id}`,
    answer_outline: "outline",
    difficulty,
    origin: "generated",
    pinned: false,
  });

  return {
    source: {
      company: "Acme",
      company_url: "https://acme.test",
      role: "Eng",
      location: "",
      jd_chars: 100,
      researched_at: "2026-01-01T00:00:00Z",
      pages_used: [],
    },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: {
      title: "Eng",
      seniority: "senior",
      responsibilities: [],
      requirements: [{ id: "r1", text: "React", kind: "technical", priority: "must" }],
    },
    questions: [q("q1", 1), q("q2", 3), q("q3", 2), q("q4", 2)],
    flashcards: [],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Study sort", question_ids: ["q2", "q3"], minutes: 65 },
        { day: 2, focus: "Study sort", question_ids: ["q4", "q1"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

function kitDoc(kit: Kit, days = 2): KitDoc {
  return {
    kit,
    input: { jd: "jd", companyUrl: "https://acme.test", days },
    research: null,
  } as KitDoc;
}

describe("regenerateSection schedule", () => {
  it("rebuilds the schedule from builder question order and requested days", async () => {
    const kit = sampleKit();
    const doc = kitDoc(kit, 2);
    const next = await regenerateSection(doc, { section: "schedule" });

    expect(next.schedule.days_available).toBe(2);
    expect(next.schedule.days.flatMap((d) => d.question_ids)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(JSON.stringify(next.schedule.days)).not.toBe(JSON.stringify(kit.schedule.days));
  });
});
