import { LlmClient } from "../../src/core/llm/client.js";
import { RateLimitedQueue } from "../../src/core/llm/queue.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../../src/core/llm/types.js";

/** Requirement ids mentioned in a question-generation prompt. */
export function idsIn(prompt: string): string[] {
  return [...new Set(prompt.match(/\br\d+\b/g) ?? [])];
}

/**
 * Deterministic fake provider returning canned JSON keyed by step label. It
 * exercises the real client (JSON parse + zod validation) and the real
 * pipeline. Two behaviours help tests:
 *   - the first technical call omits the last requirement, forcing the coverage
 *     gap-fill loop to run;
 *   - any JD containing "FORCE_FAIL" makes extraction throw, so batch isolation
 *     (a failing case must not abort the run) can be verified.
 */
export function makeFakeProvider(): LlmProvider {
  let technicalCalls = 0;
  return {
    name: "fake",
    model: "fake-1",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const label = req.label;
      const json = (obj: unknown): LlmResponse => ({
        text: JSON.stringify(obj),
        provider: "fake",
        model: "fake-1",
      });

      if (label.startsWith("extract_requirements")) {
        if (req.prompt.includes("FORCE_FAIL")) {
          throw new Error("Simulated unrecoverable extraction failure");
        }
        return json({
          title: "Senior Backend Engineer",
          seniority: "senior",
          responsibilities: ["Build and operate distributed services"],
          requirements: [
            { text: "5+ years with Node.js", kind: "technical", priority: "must" },
            { text: "Distributed systems design", kind: "technical", priority: "must" },
            { text: "Mentors junior engineers", kind: "behavioural", priority: "must" },
            { text: "Kubernetes experience", kind: "technical", priority: "nice" },
          ],
          notes: "",
        });
      }
      if (label.startsWith("company_brief")) {
        return json({
          summary: "Acme builds warehouse robots.",
          what_they_do: "AMRs for fulfilment.",
          low_information: false,
        });
      }
      if (label.startsWith("generate_questions:technical")) {
        technicalCalls++;
        let ids = idsIn(req.prompt);
        if (technicalCalls === 1 && ids.length > 1) ids = ids.slice(0, -1);
        return json({
          questions: ids.map((id) => ({
            requirement_ids: [id],
            prompt: `Technical question for ${id}`,
            answer_outline: "outline",
            difficulty: 3,
          })),
        });
      }
      if (label.startsWith("generate_questions:behavioural")) {
        const ids = idsIn(req.prompt);
        return json({
          questions: ids.map((id) => ({
            requirement_ids: [id],
            prompt: `Behavioural question for ${id}`,
            answer_outline: "outline",
            difficulty: 2,
          })),
        });
      }
      if (label.startsWith("generate_questions:system-design")) {
        return json({
          questions: [
            { requirement_ids: [], prompt: "Design a fleet coordinator", answer_outline: "o", difficulty: 3 },
          ],
        });
      }
      if (label.startsWith("generate_questions:company-fit")) {
        return json({
          questions: [{ requirement_ids: [], prompt: "Why Acme?", answer_outline: "o", difficulty: 1 }],
        });
      }
      if (label.startsWith("generate_flashcards")) {
        const ids = idsIn(req.prompt);
        return json({
          flashcards: [
            { front: "Event loop?", back: "Scheduler for async callbacks.", requirement_ids: ids.slice(0, 1) },
          ],
        });
      }
      return json({});
    },
  };
}

export function fakeLlm(): LlmClient {
  return new LlmClient(
    [makeFakeProvider()],
    new RateLimitedQueue({ baseBackoffMs: 1, requestsPerMinute: 1000, tokensPerMinute: 10_000_000 }),
  );
}
