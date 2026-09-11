import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize as pathNormalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKit, type StepName, type StepStatus } from "../src/core/generateKit.js";
import { LlmClient } from "../src/core/llm/client.js";
import { RateLimitedQueue } from "../src/core/llm/queue.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../src/core/llm/types.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "site");

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let filePath = pathNormalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) return void res.writeHead(403).end();
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": extname(filePath) === ".txt" ? "text/plain" : "text/html" });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Requirement ids mentioned in a question-generation prompt. */
function idsIn(prompt: string): string[] {
  return [...new Set(prompt.match(/\br\d+\b/g) ?? [])];
}

/**
 * Fake provider returning canned JSON keyed by step label. It exercises the
 * REAL client (JSON parse + zod validation) and the REAL orchestrator/crawler.
 * The first technical call deliberately omits the last requirement to force the
 * coverage gap-fill loop; the follow-up call (fewer reqs) then covers it.
 */
function makeFakeProvider(): LlmProvider {
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
        return json({ summary: "Acme builds warehouse robots.", what_they_do: "AMRs for fulfilment.", low_information: false });
      }
      if (label.startsWith("generate_questions:technical")) {
        technicalCalls++;
        let ids = idsIn(req.prompt);
        // First technical call misses the last requirement → forces a gap.
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
          questions: [
            { requirement_ids: [], prompt: "Why Acme?", answer_outline: "o", difficulty: 1 },
          ],
        });
      }
      if (label.startsWith("generate_flashcards")) {
        const ids = idsIn(req.prompt);
        return json({
          flashcards: [{ front: "Event loop?", back: "Scheduler for async callbacks.", requirement_ids: ids.slice(0, 1) }],
        });
      }
      return json({});
    },
  };
}

function fakeLlm() {
  return new LlmClient([makeFakeProvider()], new RateLimitedQueue({ baseBackoffMs: 1, requestsPerMinute: 1000, tokensPerMinute: 10_000_000 }));
}

describe("generateKit (integration: real crawler + fake LLM)", () => {
  it("produces a valid Appendix A kit and closes coverage via a second pass", async () => {
    const steps: { name: StepName; status: StepStatus; note?: string }[] = [];
    const { kit, notes } = await generateKit(
      { jd: "Senior Backend Engineer at Acme. 5+ years Node.js. Distributed systems. Mentoring.", companyUrl: `${base}/acme/`, days: 5 },
      {
        llm: fakeLlm(),
        allowPrivateNetworks: true,
        onStep: (name, status, note) => void steps.push({ name, status, note }),
      },
    );

    // Structure is valid and the schedule spans exactly the requested days.
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.schedule.days_available).toBe(5);

    // Coverage: no must-have left uncovered, and it took more than one pass.
    const mustIds = kit.role.requirements.filter((r) => r.priority === "must").map((r) => r.id);
    const coveredByQuestions = new Set(kit.questions.flatMap((q) => q.requirement_ids));
    for (const id of mustIds) expect(coveredByQuestions.has(id)).toBe(true);
    expect(kit.coverage.passes).toBeGreaterThanOrEqual(2);
    expect(kit.coverage.uncovered_requirement_ids).not.toContain(mustIds[0]);

    // Sequencing: steps ran in the intended order and finished.
    const order = steps.filter((s) => s.status === "running").map((s) => s.name);
    expect(order).toEqual([
      "extract_requirements",
      "crawl_company_site",
      "search_public_discussion",
      "company_brief",
      "generate_questions",
      "generate_flashcards",
      "coverage_check",
      "allocate_schedule",
      "validate_kit",
    ]);

    // Crawl found and used the buried hiring page.
    expect(kit.source.pages_used.some((u) => u.includes("interview-loop"))).toBe(true);
    expect(kit.questions.length).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("still produces a valid kit when the company site is unreachable (recorded, not fatal)", async () => {
    const steps: { name: StepName; status: StepStatus }[] = [];
    const { kit } = await generateKit(
      { jd: "Backend Engineer. Node.js required.", companyUrl: `${base}/does-not-exist/`, days: 3 },
      {
        llm: fakeLlm(),
        allowPrivateNetworks: true,
        onStep: (name, status) => void steps.push({ name, status }),
      },
    );
    expect(kit.schedule.days).toHaveLength(3);
    // Crawl step reached a "skipped" terminal status (not "failed"), and the
    // run still completed to validation.
    const crawlStatuses = steps.filter((s) => s.name === "crawl_company_site").map((s) => s.status);
    expect(crawlStatuses).toContain("skipped");
    expect(crawlStatuses).not.toContain("failed");
    expect(steps.some((s) => s.name === "validate_kit" && s.status === "done")).toBe(true);
    expect(kit.source.pages_used).toEqual([]);
  });
});
