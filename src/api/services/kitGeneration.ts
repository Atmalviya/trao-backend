import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { config } from "../../config.js";
import { generateKit, type StepStatus } from "../../core/generateKit.js";
import { GenerationJob, stepNames, type GenerationJobDoc } from "../models/GenerationJob.js";
import { KitModel, type KitDoc } from "../models/Kit.js";
import { getLlm } from "./llmSingleton.js";
import { publishJobUpdate } from "./jobEvents.js";

export function inputHashOf(jd: string, companyUrl: string): string {
  return createHash("sha256").update(`${jd}\u0000${companyUrl}`).digest("hex");
}

export interface StartKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface StartKitResult {
  kit: KitDoc;
  job: GenerationJobDoc | null;
  deduped: boolean;
}

/**
 * Start (or reuse) a kit generation. Returns the kit and job documents, and a
 * flag indicating whether the generation was deduplicated.
 */
export async function startKitGeneration(
  userId: string,
  input: StartKitInput,
): Promise<StartKitResult> {
  const inputHash = inputHashOf(input.jd, input.companyUrl);

  const existing = await KitModel.findOne({ userId, inputHash });
  if (existing) {
    // Idempotent: return whatever we already have (ready, generating, or failed).
    const job = await GenerationJob.findOne({ kitId: existing._id }).sort({ createdAt: -1 });
    return { kit: existing, job, deduped: true };
  }

  let kit: KitDoc;
  try {
    kit = await KitModel.create({
      userId,
      inputHash,
      input,
      status: "generating",
      kit: null,
    });
  } catch (err) {
    if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
      const raced = await KitModel.findOne({ userId, inputHash });
      if (raced) {
        const job = await GenerationJob.findOne({ kitId: raced._id }).sort({ createdAt: -1 });
        return { kit: raced, job, deduped: true };
      }
    }
    throw err;
  }

  const job = await GenerationJob.create({
    kitId: kit._id,
    userId,
    status: "running",
    scope: "full",
    steps: stepNames.map((name) => ({ name, status: "pending" as StepStatus })),
  });

  void runGeneration(kit, job).catch((err) => {
    console.error(`Kit generation crashed for ${kit.id}:`, err);
  });

  return { kit, job, deduped: false };
}

async function runGeneration(kit: KitDoc, job: GenerationJobDoc): Promise<void> {
  const publish = () =>
    publishJobUpdate({
      jobId: job.id,
      kitId: kit.id,
      status: job.status,
      steps: job.steps as unknown[],
      error: job.error,
    });

  try {
    const { kit: generated, notes, research } = await generateKit(
      { jd: kit.input.jd, companyUrl: kit.input.companyUrl, days: kit.input.days },
      {
        llm: getLlm(),
        allowPrivateNetworks: config.ALLOW_PRIVATE_NETWORKS,
        tavilyApiKey: config.TAVILY_API_KEY,
        onStep: async (name, status, note) => {
          const step = job.steps.find((s) => s.name === name);
          if (step) {
            step.status = status;
            if (note) step.note = note;
            if (status === "running") step.startedAt = new Date();
            if (status === "done" || status === "skipped" || status === "failed") {
              step.finishedAt = new Date();
            }
          }
          await job.save();
          publish();
        },
      },
    );

    kit.kit = generated;
    kit.notes = notes;
    kit.research = research;
    kit.status = "ready";
    await kit.save();

    job.status = "done";
    await job.save();
    publish();
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "GENERATION_FAILED";
    const message = err instanceof Error ? err.message : String(err);

    kit.status = "failed";
    await kit.save();

    job.status = "failed";
    job.error = { code, message };
    await job.save();
    publish();
  }
}
