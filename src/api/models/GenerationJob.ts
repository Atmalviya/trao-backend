import mongoose from "mongoose";

/**
 * Pipeline step names, in execution order.
 */
export const stepNames = [
  "extract_requirements",
  "crawl_company_site",
  "search_public_discussion",
  "company_brief",
  "generate_questions",
  "generate_flashcards",
  "coverage_check",
  "allocate_schedule",
  "validate_kit",
] as const;
export type StepName = (typeof stepNames)[number];

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type JobStatus = "running" | "done" | "failed";

export interface JobStep {
  name: StepName;
  status: StepStatus;
  note?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface GenerationJobDoc extends mongoose.Document {
  id: string;
  _id: mongoose.Types.ObjectId;
  kitId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  status: JobStatus;
  steps: JobStep[];
  scope: "full" | "company_brief" | "questions" | "flashcards" | "schedule";
  error: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const stepSchema = new mongoose.Schema<JobStep>(
  {
    name: { type: String, enum: stepNames, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "done", "skipped", "failed"],
      required: true,
      default: "pending",
    },
    note: String,
    startedAt: Date,
    finishedAt: Date,
  },
  { _id: false },
);

const jobSchema = new mongoose.Schema<GenerationJobDoc>(
  {
    kitId: { type: mongoose.Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["running", "done", "failed"], default: "running" },
    steps: { type: [stepSchema], default: [] },
    scope: {
      type: String,
      enum: ["full", "company_brief", "questions", "flashcards", "schedule"],
      default: "full",
    },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const GenerationJob = mongoose.model<GenerationJobDoc>("GenerationJob", jobSchema);
