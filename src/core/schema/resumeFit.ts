import { z } from "zod";
import { requirementPriorities } from "./kit.js";

export const fitStatuses = ["met", "partial", "gap", "unclear"] as const;
export const qualifiesValues = [
  "likely",
  "partial",
  "unlikely",
  "insufficient_data",
] as const;

export type FitStatus = (typeof fitStatuses)[number];
export type Qualifies = (typeof qualifiesValues)[number];

export interface ResumeFileMeta {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  extractionMethod: "plain" | "docx" | "pdf";
  charCount: number;
  warnings: string[];
}

export interface ResumeFitRequirement {
  requirementId: string;
  priority: (typeof requirementPriorities)[number];
  status: FitStatus;
  evidence: string;
  prepNote: string;
}

export interface ResumeFit {
  analyzedAt: string;
  resumeChars: number;
  overall: {
    mustMet: number;
    mustTotal: number;
    mustGapCount: number;
    qualifies: Qualifies;
    summary: string;
  };
  requirements: ResumeFitRequirement[];
  strengths: string[];
  focusAreas: string[];
  risks: string[];
}

export type ResumeFitStatus = "none" | "pending" | "analyzing" | "ready" | "failed";

/** LLM output — requirement refs by id assigned in code. */
export const resumeFitLlmSchema = z.object({
  requirements: z.array(
    z.object({
      requirement_id: z.string(),
      status: z.enum(fitStatuses),
      evidence: z.string(),
      prep_note: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
  focus_area_notes: z.array(z.string()),
  risks: z.array(z.string()),
  summary: z.string(),
});

export type ResumeFitLlmOutput = z.infer<typeof resumeFitLlmSchema>;
