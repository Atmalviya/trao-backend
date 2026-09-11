import { describe, expect, it } from "vitest";
import { analyzeResumeFit } from "../src/core/pipeline/analyzeResumeFit.js";
import type { Requirement } from "../src/core/schema/kit.js";
import { fakeLlm } from "./helpers/fakeLlm.js";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must" },
  { id: "r2", text: "Distributed systems design", kind: "technical", priority: "must" },
  { id: "r3", text: "Kubernetes experience", kind: "technical", priority: "nice" },
];

describe("analyzeResumeFit", () => {
  it("returns a fit row per requirement with deterministic qualifies overlay", async () => {
    const fit = await analyzeResumeFit(
      fakeLlm(),
      "We need a senior backend engineer with Node.js.",
      "Built Node.js services for 6 years. Designed event-driven pipelines.",
      requirements,
    );

    expect(fit.requirements).toHaveLength(3);
    expect(fit.requirements.every((r) => requirements.some((q) => q.id === r.requirementId))).toBe(
      true,
    );
    expect(fit.overall.mustTotal).toBe(2);
    expect(["likely", "partial", "unlikely", "insufficient_data"]).toContain(
      fit.overall.qualifies,
    );
    expect(fit.strengths.length).toBeGreaterThan(0);
  });

  it("marks insufficient_data for very thin resumes", async () => {
    const fit = await analyzeResumeFit(fakeLlm(), "JD text", "Hi.", requirements);
    expect(fit.overall.qualifies).toBe("insufficient_data");
  });
});
