import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateBody } from "../middleware/validate.js";
import { GenerationJob } from "../models/GenerationJob.js";
import { KitModel, type KitDoc } from "../models/Kit.js";
import { subscribeJob, type JobUpdate } from "../services/jobEvents.js";
import { startKitGeneration } from "../services/kitGeneration.js";
import { ownedKit } from "../services/ownership.js";

export const kitsRouter = Router();
kitsRouter.use(requireAuth);

const createSchema = z.object({
  jd: z.string().min(1, "Job description is required").max(50_000),
  companyUrl: z.string().min(1, "Company URL is required").max(2_000),
  days: z.number().int().min(1).max(60),
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

// Create a kit and start generation (idempotent per posting).
kitsRouter.post("/", validateBody(createSchema), async (req, res) => {
  const userId = req.session.userId!;
  const { kit, deduped } = await startKitGeneration(userId, req.body);
  res.status(deduped ? 200 : 201).json({ id: kit.id, status: kit.status, deduped });
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
    job: job ? { id: job.id, status: job.status, steps: job.steps, error: job.error } : null,
  });
});

kitsRouter.delete("/:id", async (req, res) => {
  const kit = await ownedKit(req.session.userId!, req.params.id!);
  await GenerationJob.deleteMany({ kitId: kit._id });
  await kit.deleteOne();
  res.status(204).end();
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
