import { describe, expect, it } from "vitest";
import { checkCoverage, uncoveredRequirements } from "../src/core/coverage.js";
import type { Question, Requirement } from "../src/core/schema/kit.js";

const reqs: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Node", kind: "technical", priority: "must" },
  { id: "r3", text: "Mentoring", kind: "behavioural", priority: "nice" },
];

function q(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: "technical",
    prompt: "p",
    answer_outline: "a",
    difficulty: 2,
    origin: "generated",
    pinned: false,
  };
}

describe("checkCoverage", () => {
  it("reports full coverage when every requirement has a question", () => {
    const report = checkCoverage(reqs, [q("q1", ["r1"]), q("q2", ["r2"]), q("q3", ["r3"])]);
    expect(report.uncovered).toEqual([]);
    expect(report.uncoveredMust).toEqual([]);
    expect(report.covered.sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("identifies uncovered requirements and flags uncovered musts", () => {
    const report = checkCoverage(reqs, [q("q1", ["r1"])]);
    expect(report.uncovered.sort()).toEqual(["r2", "r3"]);
    expect(report.uncoveredMust).toEqual(["r2"]); // r3 is "nice", not flagged as must
  });

  it("counts multiple questions per requirement", () => {
    const report = checkCoverage(reqs, [q("q1", ["r1"]), q("q2", ["r1", "r2"])]);
    expect(report.countsByRequirement.r1).toBe(2);
    expect(report.countsByRequirement.r2).toBe(1);
    expect(report.countsByRequirement.r3).toBe(0);
  });

  it("ignores question references to unknown requirement ids", () => {
    const report = checkCoverage(reqs, [q("q1", ["r1", "rX"])]);
    expect(report.countsByRequirement).not.toHaveProperty("rX");
    expect(report.covered).toContain("r1");
  });

  it("uncoveredRequirements returns the requirement objects still missing", () => {
    const missing = uncoveredRequirements(reqs, [q("q1", ["r1"])]);
    expect(missing.map((r) => r.id).sort()).toEqual(["r2", "r3"]);
  });
});
