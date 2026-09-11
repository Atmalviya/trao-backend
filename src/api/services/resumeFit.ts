import { analyzeResumeFit } from "../../core/pipeline/analyzeResumeFit.js";
import type { ResumeFileMeta, ResumeFit } from "../../core/schema/resumeFit.js";
import { GenerationJob, type GenerationJobDoc } from "../models/GenerationJob.js";
import { KitModel, type KitDoc } from "../models/Kit.js";
import { getLlm } from "./llmSingleton.js";
import { publishJobUpdate } from "./jobEvents.js";
import type { StepStatus } from "../../core/generateKit.js";

export interface SavedResume {
  resumeText: string;
  resumeFileMeta: ResumeFileMeta;
}

/** Persist extracted resume text and metadata on a kit. */
export async function saveResumeOnKit(kit: KitDoc, saved: SavedResume): Promise<void> {
  kit.resumeText = saved.resumeText;
  kit.resumeFileMeta = saved.resumeFileMeta;
  kit.resumeFitStatus = kit.kit ? "pending" : "none";
  kit.resumeFit = undefined;
  kit.resumeFitError = undefined;
  await kit.save();
}

async function reportStep(
  job: GenerationJobDoc,
  status: StepStatus,
  note?: string,
): Promise<void> {
  const step = job.steps.find((s) => s.name === "analyze_resume_fit");
  if (step) {
    step.status = status;
    if (note) step.note = note;
    if (status === "running") step.startedAt = new Date();
    if (status === "done" || status === "skipped" || status === "failed") {
      step.finishedAt = new Date();
    }
  }
  await job.save();
  publishJobUpdate({
    jobId: job.id,
    kitId: String(job.kitId),
    status: job.status,
    steps: job.steps as unknown[],
    error: job.error,
  });
}

/**
 * Run resume fit analysis for a kit that already has resumeText and a valid kit.
 * Used after full generation and for fit-only re-runs.
 */
export async function runResumeFitAnalysis(
  kit: KitDoc,
  job?: GenerationJobDoc,
  opts: { failJobOnError?: boolean } = {},
): Promise<ResumeFit | null> {
  const failJobOnError =
    opts.failJobOnError !== undefined
      ? opts.failJobOnError
      : !job || job.scope === "resume_fit";
  if (!kit.resumeText?.trim()) return null;
  if (!kit.kit?.role?.requirements?.length) {
    throw new Error("Kit requirements are not available yet.");
  }

  kit.resumeFitStatus = "analyzing";
  kit.resumeFitError = undefined;
  await kit.save();

  if (job) await reportStep(job, "running");

  try {
    const fit = await analyzeResumeFit(
      getLlm(),
      kit.input.jd,
      kit.resumeText,
      kit.kit.role.requirements,
    );

    kit.resumeFit = fit;
    kit.resumeFitStatus = "ready";
    kit.resumeFitError = undefined;
    await kit.save();

    if (job) {
      await reportStep(
        job,
        "done",
        `${fit.overall.mustMet}/${fit.overall.mustTotal} must-haves supported (${fit.overall.qualifies}).`,
      );
      job.status = "done";
      await job.save();
      publishJobUpdate({
        jobId: job.id,
        kitId: kit.id,
        status: job.status,
        steps: job.steps as unknown[],
        error: job.error,
      });
    }

    return fit;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Resume fit analysis failed.";
    kit.resumeFitStatus = "failed";
    kit.resumeFitError = message;
    await kit.save();

    if (job) {
      await reportStep(job, "failed", message);
      if (failJobOnError) {
        job.status = "failed";
        job.error = { code: "RESUME_FIT_FAILED", message };
      } else {
        job.status = "done";
        job.error = null;
      }
      await job.save();
      publishJobUpdate({
        jobId: job.id,
        kitId: kit.id,
        status: job.status,
        steps: job.steps as unknown[],
        error: job.error,
      });
    }

    return null;
  }
}

/** Start a fit-only background job (upload or re-analyze on a ready kit). */
export async function startResumeFitJob(kit: KitDoc, userId: string): Promise<GenerationJobDoc> {
  const job = await GenerationJob.create({
    kitId: kit._id,
    userId,
    status: "running",
    scope: "resume_fit",
    steps: [{ name: "analyze_resume_fit", status: "pending" }],
  });

  void runResumeFitAnalysis(kit, job).catch((err) => {
    console.error(`Resume fit job crashed for kit ${kit.id}:`, err);
  });

  return job;
}

/** Load kit by id for resume routes — throws if not found. */
export async function kitForResume(userId: string, kitId: string): Promise<KitDoc> {
  const kit = await KitModel.findOne({ _id: kitId, userId });
  if (!kit) throw new Error("Kit not found");
  return kit;
}
