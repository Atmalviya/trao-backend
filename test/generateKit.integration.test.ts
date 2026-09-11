import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize as pathNormalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKit, type StepName, type StepStatus } from "../src/core/generateKit.js";
import { fakeLlm } from "./helpers/fakeLlm.js";

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
