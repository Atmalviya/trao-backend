import { z } from "zod";
import type { LlmClient } from "../llm/index.js";
import { requirementKinds, requirementPriorities, type Requirement } from "../schema/kit.js";
import { clamp, INJECTION_GUARD, wrapUntrusted } from "./prompt.js";

/** LLM output shape — no ids; code assigns stable r1..rn afterwards. */
const extractionSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(requirementKinds),
      priority: z.enum(requirementPriorities),
    }),
  ),
  /** The model's honest note when the description is thin. */
  notes: z.string().optional(),
});

export interface ExtractionResult {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
  jdChars: number;
  notes: string;
}

const SYSTEM = [
  "You extract structured requirements from a job description for interview prep.",
  INJECTION_GUARD,
  "",
  "Rules you must follow:",
  "- Extract ONLY what the description actually states. Never invent skills,",
  "  years of experience, or responsibilities that are not present. Inventing",
  "  requirements is worse than reporting that there were few.",
  "- Mark each requirement priority from how the posting words it:",
  "    * 'must' for required / must-have / 'X years of' / 'strong' hard needs.",
  "    * 'nice' for bonus / preferred / 'nice to have' / 'a plus' items.",
  "  A required line and a 'bonus points for' line are NOT the same thing.",
  "- kind: 'technical' (tools, languages, systems), 'behavioural' (mentoring,",
  "  communication, leadership), or 'domain' (industry/domain knowledge).",
  "- Split compound requirements into separate atomic items where sensible.",
  "- If the description is a thin stub, return the few requirements it contains",
  "  and say so in 'notes'. Do not pad it out.",
].join("\n");

/**
 * Step 1 of the pipeline. Deterministic id assignment (r1..rn) happens in code,
 * not in the model, so ids are always stable and unique within a kit.
 */
export async function extractRequirements(
  llm: LlmClient,
  jd: string,
): Promise<ExtractionResult> {
  const prompt = [
    "Extract the role details and requirements from this job description.",
    wrapUntrusted("JOB DESCRIPTION", clamp(jd, 12_000)),
  ].join("\n\n");

  const out = await llm.generate({
    system: SYSTEM,
    prompt,
    schema: extractionSchema,
    label: "extract_requirements",
  });

  const requirements: Requirement[] = out.requirements.map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text,
    kind: r.kind,
    priority: r.priority,
  }));

  return {
    title: out.title,
    seniority: out.seniority,
    responsibilities: out.responsibilities,
    requirements,
    jdChars: jd.length,
    notes: out.notes ?? "",
  };
}
