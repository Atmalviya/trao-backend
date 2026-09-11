import { generateKit, type StepReporter } from "./generateKit.js";
import type { LlmClient } from "./llm/index.js";
import type { Kit } from "./schema/kit.js";

export interface BatchCase {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface BatchKitEntry {
  id: string;
  status: "ok" | "failed";
  kit: Kit | null;
  error: { code: string; message: string } | null;
}

export interface BatchOutput {
  version: string;
  generated_at: string;
  kits: BatchKitEntry[];
}

export interface RunBatchDeps {
  llm: LlmClient;
  allowPrivateNetworks: boolean;
  tavilyApiKey?: string;
  maxCoveragePasses?: number;
  /** Called as each case starts (for CLI progress logging). */
  onCaseStart?: (index: number, total: number, testCase: BatchCase) => void;
  /** Per-step reporter, scoped per case. */
  onStep?: (caseId: string) => StepReporter;
  /** Called when a case finishes (for CLI progress logging). */
  onCaseDone?: (entry: BatchKitEntry, elapsedMs: number) => void;
}

/**
 * Run the pipeline over a set of cases. This is the shared implementation used
 * by the batch CLI; keeping it in core (rather than in the script) means the
 * CLI and any other caller run exactly the same code path. Each case is fully
 * isolated: a failure is captured as a `failed` entry and the loop continues.
 * Cases run sequentially so the shared LLM rate-limit queue is respected.
 */
export async function runBatch(cases: BatchCase[], deps: RunBatchDeps): Promise<BatchOutput> {
  const kits: BatchKitEntry[] = [];

  for (const [index, testCase] of cases.entries()) {
    deps.onCaseStart?.(index, cases.length, testCase);
    const started = Date.now();
    let entry: BatchKitEntry;
    try {
      const { kit } = await generateKit(
        { jd: testCase.jd, companyUrl: testCase.company_url, days: testCase.days },
        {
          llm: deps.llm,
          allowPrivateNetworks: deps.allowPrivateNetworks,
          tavilyApiKey: deps.tavilyApiKey,
          maxCoveragePasses: deps.maxCoveragePasses,
          onStep: deps.onStep?.(testCase.id),
        },
      );
      entry = { id: testCase.id, status: "ok", kit, error: null };
    } catch (err) {
      entry = {
        id: testCase.id,
        status: "failed",
        kit: null,
        error: { code: errorCode(err), message: err instanceof Error ? err.message : String(err) },
      };
    }
    kits.push(entry);
    deps.onCaseDone?.(entry, Date.now() - started);
  }

  return { version: "1.0", generated_at: new Date().toISOString(), kits };
}

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "GENERATION_FAILED";
}
