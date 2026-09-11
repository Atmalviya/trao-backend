import { z } from "zod";
import type { LlmClient } from "../llm/index.js";
import { INJECTION_GUARD } from "./prompt.js";
import type { Flashcard, Requirement } from "../schema/kit.js";

const flashcardOutputSchema = z.object({
  flashcards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      requirement_ids: z.array(z.string()),
    }),
  ),
});

const SYSTEM = [
  "You create study flashcards for interview preparation.",
  INJECTION_GUARD,
  "",
  "Rules:",
  "- Each card has a concise 'front' (a prompt/term/question) and a crisp 'back'",
  "  (the answer or explanation).",
  "- Prioritise must-have requirements and core concepts a candidate should recall.",
  "- Map each card to the requirement id(s) it reinforces using only the given ids.",
  "- Do not invent facts about the company.",
].join("\n");

/**
 * Step: flashcards, derived from the requirements (must-haves first). Stable
 * f-ids assigned in code; hallucinated requirement ids are dropped.
 */
export async function generateFlashcards(
  llm: LlmClient,
  requirements: Requirement[],
  companyContext: string,
): Promise<Flashcard[]> {
  if (requirements.length === 0) return [];

  const reqList = requirements
    .map((r) => `- ${r.id} [${r.priority}/${r.kind}]: ${r.text}`)
    .join("\n");
  const target = Math.max(4, Math.min(12, requirements.length + 2));

  const out = await llm.generate({
    system: SYSTEM,
    prompt: [
      `Create about ${target} flashcards covering these requirements:`,
      reqList,
      companyContext ? `Company context (optional grounding):\n${companyContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: flashcardOutputSchema,
    label: "generate_flashcards",
  });

  const validIds = new Set(requirements.map((r) => r.id));
  return out.flashcards.map((f, i) => ({
    id: `f${i + 1}`,
    front: f.front,
    back: f.back,
    requirement_ids: f.requirement_ids.filter((id) => validIds.has(id)),
    origin: "generated" as const,
    pinned: false,
  }));
}
