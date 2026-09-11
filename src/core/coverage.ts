import type { Question, Requirement } from "./schema/kit.js";

export interface CoverageReport {
  uncovered: string[];
  uncoveredMust: string[];
  covered: string[];
  countsByRequirement: Record<string, number>;
}

/** Deterministic coverage check. */
export function checkCoverage(requirements: Requirement[], questions: Question[]): CoverageReport {
  const counts: Record<string, number> = {};
  for (const r of requirements) counts[r.id] = 0;

  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      if (rid in counts) counts[rid]! += 1;
    }
  }

  const uncovered: string[] = [];
  const covered: string[] = [];
  for (const r of requirements) {
    if ((counts[r.id] ?? 0) > 0) covered.push(r.id);
    else uncovered.push(r.id);
  }

  const mustIds = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const uncoveredMust = uncovered.filter((id) => mustIds.has(id));

  return { uncovered, uncoveredMust, covered, countsByRequirement: counts };
}

/** Convenience: the requirements still missing a question. */
export function uncoveredRequirements(
  requirements: Requirement[],
  questions: Question[],
): Requirement[] {
  const report = checkCoverage(requirements, questions);
  const set = new Set(report.uncovered);
  return requirements.filter((r) => set.has(r.id));
}
