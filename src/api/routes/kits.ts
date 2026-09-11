import { Router } from "express";
import { z } from "zod";
import {
  extractResumeText,
  ResumeExtractionError,
} from "../../core/resume/extractResumeText.js";
import type { ResumeFileMeta } from "../../core/schema/resumeFit.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { multerErrorHandler, resumeUpload } from "../middleware/resumeUpload.js";
import { validateBody } from "../middleware/validate.js";
import { GenerationJob } from "../models/GenerationJob.js";
import { KitModel, type KitDoc } from "../models/Kit.js";
import { subscribeJob, type JobUpdate } from "../services/jobEvents.js";
import { startKitGeneration } from "../services/kitGeneration.js";
import { ownedKit } from "../services/ownership.js";
import { saveResumeOnKit, startResumeFitJob } from "../services/resumeFit.js";

export const kitsRouter = Router();
kitsRouter.use(requireAuth);

const createSchema = z.object({
  jd: z.string().min(1, "Job description is required").max(50_000),
  companyUrl: z.string().min(1, "Company URL is required").max(2_000),
  days: z.coerce.number().int().min(1).max(60),
});

const batchSchema = z.object({
  cases: z.array(createSchema).min(1).max(20),
});

function kitSummary(k: KitDoc) {
  return {
    id: k.id,
    status: k.status,
    role: k.kit?.role?.title ?? null,
    company: k.kit?.source?.company ?? null,
    companyUrl: k.input.companyUrl,
    days: k.input.days,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

function resumePublicFields(k: KitDoc) {
  return {
    resumeFileMeta: k.resumeFileMeta ?? null,
    resumeFit: k.resumeFit ?? null,
    resumeFitStatus: k.resumeFitStatus ?? "none",
    resumeFitError: k.resumeFitError ?? null,
  };
}

async function extractionFromFile(
  file: Express.Multer.File,
): Promise<{ resumeText: string; resumeFileMeta: ResumeFileMeta }> {
  try {
    const extracted = await extractResumeText(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
    return {
      resumeText: extracted.text,
      resumeFileMeta: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        extractionMethod: extracted.method,
        charCount: extracted.charCount,
        warnings: extracted.warnings,
      },
    };
  } catch (err) {
    if (err instanceof ResumeExtractionError) {
      const status = err.code === "NO_TEXT" || err.code === "EMPTY_FILE" ? 400 : 400;
      throw new ApiError(status, err.code, err.message);
    }
    throw err;
  }
}

function parseCreateFields(body: Record<string, unknown>) {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join("; ");
    throw new ApiError(400, "VALIDATION_ERROR", detail || "Invalid kit input.");
  }
  return parsed.data;
}

// Create a kit and start generation (idempotent per posting). Accepts JSON or multipart.
kitsRouter.post("/", (req, res, next) => {
  resumeUpload.single("resume")(req, res, (err) => {
    if (err) {
      if (err.message === "UNSUPPORTED_TYPE") {
        next(new ApiError(400, "UNSUPPORTED_TYPE", "Use PDF, DOCX, TXT, or MD."));
        return;
      }
      try {
        multerErrorHandler(err);
      } catch (e) {
        next(e);
      }
      return;
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const userId = req.session.userId!;
    const fields = parseCreateFields(req.body as Record<string, unknown>);

    let resumeText: string | undefined;
    let resumeFileMeta: ResumeFileMeta | undefined;

    if (req.file) {
      const saved = await extractionFromFile(req.file);
      resumeText = saved.resumeText;
      resumeFileMeta = saved.resumeFileMeta;
    }

    const { kit, deduped } = await startKitGeneration(userId, {
      ...fields,
      resumeText,
      resumeFileMeta,
    });
    res.status(deduped ? 200 : 201).json({ id: kit.id, status: kit.status, deduped });
  } catch (err) {
    next(err);
  }
});

// Prepare several roles at once (pasted pairs or an uploaded file, parsed client-side).
kitsRouter.post("/batch", validateBody(batchSchema), async (req, res) => {
  const userId = req.session.userId!;
  const { cases } = req.body as z.infer<typeof batchSchema>;
  const results = [];
  for (const c of cases) {
    const { kit, deduped } = await startKitGeneration(userId, c);
    results.push({ id: kit.id, status: kit.status, deduped, companyUrl: c.companyUrl });
  }
  res.status(201).json({ kits: results });
});

// List only the caller's kits.
kitsRouter.get("/", async (req, res) => {
  const kits = await KitModel.find({ userId: req.session.userId }).sort({ createdAt: -1 });
  res.json({ kits: kits.map(kitSummary) });
});

// Full kit + latest job state.
kitsRouter.get("/:id", async (req, res) => {
  const kit = await ownedKit(req.session.userId!, req.params.id!);
  const job = await GenerationJob.findOne({ kitId: kit._id }).sort({ createdAt: -1 });
  res.json({
    id: kit.id,
    status: kit.status,
    input: kit.input,
    kit: kit.kit,
    notes: kit.notes,
    ...resumePublicFields(kit),
    job: job ? { id: job.id, status: job.status, steps: job.steps, error: job.error } : null,
  });
});

kitsRouter.delete("/:id", async (req, res) => {
  const kit = await ownedKit(req.session.userId!, req.params.id!);
  await GenerationJob.deleteMany({ kitId: kit._id });
  await kit.deleteOne();
  res.status(204).end();
});

// Upload or replace resume and run fit analysis.
kitsRouter.post("/:id/resume", (req, res, next) => {
  resumeUpload.single("resume")(req, res, (err) => {
    if (err) {
      if (err.message === "UNSUPPORTED_TYPE") {
        next(new ApiError(400, "UNSUPPORTED_TYPE", "Use PDF, DOCX, TXT, or MD."));
        return;
      }
      try {
        multerErrorHandler(err);
      } catch (e) {
        next(e);
      }
      return;
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const kit = await ownedKit(req.session.userId!, req.params.id!);
    if (kit.status === "generating") {
      throw new ApiError(409, "KIT_GENERATING", "Wait until kit generation finishes.");
    }
    if (!req.file) {
      throw new ApiError(400, "MISSING_FILE", "Resume file is required.");
    }

    const saved = await extractionFromFile(req.file);
    await saveResumeOnKit(kit, saved);

    const job = await startResumeFitJob(kit, req.session.userId!);
    res.status(202).json({
      resumeFileMeta: kit.resumeFileMeta,
      resumeFitStatus: kit.resumeFitStatus,
      job: { id: job.id, status: job.status, steps: job.steps },
    });
  } catch (err) {
    next(err);
  }
});

// Re-run fit analysis on stored resume text.
kitsRouter.post("/:id/resume/analyze", async (req, res, next) => {
  try {
    const kit = await ownedKit(req.session.userId!, req.params.id!);
    if (kit.status !== "ready") {
      throw new ApiError(409, "KIT_NOT_READY", "Kit must be ready before re-analyzing.");
    }
    if (!kit.resumeText?.trim()) {
      throw new ApiError(400, "NO_RESUME", "Upload a resume first.");
    }

    const job = await startResumeFitJob(kit, req.session.userId!);
    res.status(202).json({
      resumeFitStatus: "analyzing",
      job: { id: job.id, status: job.status, steps: job.steps },
    });
  } catch (err) {
    next(err);
  }
});

// Server-Sent Events stream of generation progress.
kitsRouter.get("/:id/events", async (req, res) => {
  const kit = await ownedKit(req.session.userId!, req.params.id!);
  const job = await GenerationJob.findOne({ kitId: kit._id }).sort({ createdAt: -1 });
  if (!job) throw new ApiError(404, "NOT_FOUND", "No generation job for this kit");

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (u: Pick<JobUpdate, "status" | "steps" | "error">) => {
    res.write(`data: ${JSON.stringify(u)}\n\n`);
  };

  // Initial snapshot for clients that connect mid-run.
  send({ status: job.status, steps: job.steps, error: job.error });
  if (job.status !== "running") {
    res.end();
    return;
  }

  const unsubscribe = subscribeJob(job.id, (u) => {
    send({ status: u.status, steps: u.steps, error: u.error } as JobUpdate);
    if (u.status !== "running") {
      unsubscribe();
      res.end();
    }
  });

  // Heartbeat keeps proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
