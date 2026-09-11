/**
 * Batch entry point (Section 9, mandatory):
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Thin IO wrapper around core/runBatch, which runs the SAME generateKit
 * pipeline the API uses. Reads an array of {id, jd, company_url, days}, writes
 * one entry per case in the Appendix B shape, continues after a case fails, and
 * runs cases sequentially so the shared LLM rate-limit queue keeps us within
 * free-tier limits. Credentials come from env (.env.example); no database is
 * needed and it runs from a clean clone.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runBatch, type BatchCase } from "../src/core/batch.js";
import { createLlmClient } from "../src/core/llm/index.js";

const casesSchema = z.array(
  z.object({
    id: z.string(),
    jd: z.string(),
    company_url: z.string(),
    days: z.number().int().positive(),
  }),
);

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
    },
  });

  if (!values.input || !values.output) {
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(2);
  }

  // Fail fast if no provider is configured — clearer than failing every case.
  const llm = createLlmClient({
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    geminiApiVersion: process.env.GEMINI_API_VERSION,
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL,
    rateLimit: process.env.LLM_RPM
      ? { requestsPerMinute: Number(process.env.LLM_RPM) }
      : undefined,
  });

  const raw = await readFile(values.input, "utf-8");
  const parsed = casesSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Invalid input file — expected an array of {id, jd, company_url, days}:");
    console.error(parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(2);
  }
  const cases: BatchCase[] = parsed.data;

  console.error(`Running ${cases.length} case(s)…`);
  const output = await runBatch(cases, {
    llm,
    allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === "true",
    tavilyApiKey: process.env.TAVILY_API_KEY,
    onCaseStart: (i, total, c) => console.error(`[${i + 1}/${total}] ${c.id} — ${c.company_url}`),
    onStep: (caseId) => (name, status, note) =>
      void console.error(`    ${name}: ${status}${note ? ` — ${note}` : ""}`),
    onCaseDone: (entry, ms) =>
      console.error(
        entry.status === "ok"
          ? `    ✓ ok in ${(ms / 1000).toFixed(1)}s`
          : `    ✗ failed (${entry.error?.code}): ${entry.error?.message}`,
      ),
  });

  await writeFile(values.output, JSON.stringify(output, null, 2), "utf-8");
  const okCount = output.kits.filter((k) => k.status === "ok").length;
  console.error(`Done: ${okCount}/${output.kits.length} ok. Wrote ${values.output}`);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
