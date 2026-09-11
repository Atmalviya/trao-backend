import type { LlmClient } from "../llm/index.js";
import type { Requirement } from "../schema/kit.js";
import {
  type FitStatus,
  type Qualifies,
  type ResumeFit,
  resumeFitLlmSchema,
} from "../schema/resumeFit.js";
import { clamp, INJECTION_GUARD, wrapUntrusted } from "./prompt.js";

const MIN_USEFUL_CHARS = 200;

const SYSTEM = [
  "You analyse how a candidate's resume matches job requirements for interview prep.",
  INJECTION_GUARD,
  "",
  "Rules:",
  "- Only mark 'met' when the resume explicitly supports the requirement.",
  "- 'partial' = related experience but weak or indirect (adjacent tech, no years stated).",
  "- 'gap' = no reasonable evidence in the resume.",
  "- 'unclear' = resume is too vague to tell.",
  "- Never invent experience not present in the resume.",
  "- Return one row per requirement_id provided — use exactly those ids.",
  "- Be honest in summary and risks when the resume is thin.",
].join("\n");

function computeQualifies(
  rows: { priority: string; status: FitStatus }[],
  resumeChars: number,
): Qualifies {
  if (resumeChars < MIN_USEFUL_CHARS) return "insufficient_data";

  const must = rows.filter((r) => r.priority === "must");
  const unclearCount = rows.filter((r) => r.status === "unclear").length;
  if (rows.length > 0 && unclearCount / rows.length > 0.5) return "insufficient_data";

  const mustGaps = must.filter((r) => r.status === "gap").length;
  const mustPartial = must.filter((r) => r.status === "partial").length;

  if (mustGaps === 0 && must.every((r) => r.status === "met" || r.status === "partial")) {
    return "likely";
  }
  if (mustGaps >= 2) return "unlikely";
  if (mustGaps >= 1 || mustPartial >= Math.ceil(must.length / 2)) return "partial";
  return "likely";
}

function buildFocusAreas(rows: ResumeFit["requirements"]): string[] {
  const order: FitStatus[] = ["gap", "partial", "unclear"];
  const priorityOrder = (p: string) => (p === "must" ? 0 : 1);

  const sorted = [...rows].sort((a, b) => {
    const pa = priorityOrder(a.priority);
    const pb = priorityOrder(b.priority);
    if (pa !== pb) return pa - pb;
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  const areas: string[] = [];
  for (const row of sorted) {
    if (row.status === "met") continue;
    const label = `${row.requirementId}: ${row.prepNote || row.status}`;
    if (!areas.includes(label)) areas.push(label);
  }
  return areas.slice(0, 12);
}

/**
 * Compare extracted resume text against final kit requirements.
 * Deterministic qualify summary and focus ordering applied after the LLM pass.
 */
export async function analyzeResumeFit(
  llm: LlmClient,
  jd: string,
  resumeText: string,
  requirements: Requirement[],
): Promise<ResumeFit> {
  const reqList = requirements.map((r) => ({
    id: r.id,
    text: r.text,
    kind: r.kind,
    priority: r.priority,
  }));

  const prompt = [
    "For each requirement_id, assess how well the resume supports it.",
    "",
    wrapUntrusted("JOB DESCRIPTION", clamp(jd, 8_000)),
    "",
    wrapUntrusted("RESUME", clamp(resumeText, 12_000)),
    "",
    "REQUIREMENTS (use these ids exactly):",
    JSON.stringify(reqList, null, 2),
    "",
    "Respond with JSON: requirements[{requirement_id, status, evidence, prep_note}],",
    "strengths[], focus_area_notes[], risks[], summary (2-3 sentences).",
  ].join("\n");

  const llmOut = await llm.generate({
    system: SYSTEM,
    prompt,
    schema: resumeFitLlmSchema,
    label: "analyze_resume_fit",
  });

  const byId = new Map(requirements.map((r) => [r.id, r]));
  const requirementsOut: ResumeFit["requirements"] = [];

  for (const row of llmOut.requirements) {
    const req = byId.get(row.requirement_id);
    if (!req) continue;
    requirementsOut.push({
      requirementId: req.id,
      priority: req.priority,
      status: row.status,
      evidence: row.evidence.trim(),
      prepNote: row.prep_note.trim(),
    });
  }

  for (const req of requirements) {
    if (!requirementsOut.some((r) => r.requirementId === req.id)) {
      requirementsOut.push({
        requirementId: req.id,
        priority: req.priority,
        status: "unclear",
        evidence: "",
        prepNote: "Could not assess this requirement from the resume.",
      });
    }
  }

  const mustRows = requirementsOut.filter((r) => r.priority === "must");
  const mustMet = mustRows.filter((r) => r.status === "met" || r.status === "partial").length;
  const mustGapCount = mustRows.filter((r) => r.status === "gap").length;

  const qualifies = computeQualifies(requirementsOut, resumeText.length);
  const focusFromLlm = llmOut.focus_area_notes.filter(Boolean);
  const focusAreas =
    focusFromLlm.length > 0 ? focusFromLlm.slice(0, 12) : buildFocusAreas(requirementsOut);

  return {
    analyzedAt: new Date().toISOString(),
    resumeChars: resumeText.length,
    overall: {
      mustMet,
      mustTotal: mustRows.length,
      mustGapCount,
      qualifies,
      summary: llmOut.summary.trim(),
    },
    requirements: requirementsOut,
    strengths: llmOut.strengths.filter(Boolean).slice(0, 8),
    focusAreas,
    risks: llmOut.risks.filter(Boolean).slice(0, 8),
  };
}
