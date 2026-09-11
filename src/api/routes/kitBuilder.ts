import { Router } from "express";
import { z } from "zod";
import {
  addFlashcard,
  addQuestion,
  deleteFlashcard,
  deleteQuestion,
  editBrief,
  editFlashcard,
  editQuestion,
  reorderQuestions,
} from "../../core/kitEdits.js";
import { questionCategories, validateKit, type Kit } from "../../core/schema/kit.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateBody } from "../middleware/validate.js";
import type { KitDoc } from "../models/Kit.js";
import { assertReady, ownedKit } from "../services/ownership.js";
import { regenerateSection } from "../services/regenerate.js";

export const builderRouter = Router();
builderRouter.use(requireAuth);

const categoryEnum = z.enum(questionCategories);
const difficulty = z.number().int().min(1).max(3);

/** Apply a pure edit to the kit body, validate, persist, and return it. */
async function applyEdit(kitDoc: KitDoc, mutate: (kit: Kit) => Kit) {
  assertReady(kitDoc);
  const next = mutate(kitDoc.kit);
  const { kit, issues } = validateKit(next);
  if (!kit) {
    throw new ApiError(422, "INVALID_EDIT", issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }
  kitDoc.kit = kit;
  kitDoc.markModified("kit");
  await kitDoc.save();
  return kit;
}

// ---- Questions ----
const questionPatch = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().optional(),
  category: categoryEnum.optional(),
  difficulty: difficulty.optional(),
  requirement_ids: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

builderRouter.patch("/:id/questions/:qid", validateBody(questionPatch), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => editQuestion(k, String(req.params.qid), req.body));
  res.json({ kit });
});

const newQuestion = z.object({
  prompt: z.string().min(1),
  answer_outline: z.string().default(""),
  category: categoryEnum,
  difficulty,
  requirement_ids: z.array(z.string()).default([]),
});

builderRouter.post("/:id/questions", validateBody(newQuestion), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => addQuestion(k, req.body));
  res.status(201).json({ kit });
});

builderRouter.delete("/:id/questions/:qid", async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => deleteQuestion(k, String(req.params.qid)));
  res.json({ kit });
});

const reorderPayload = z.object({
  items: z.array(z.object({ id: z.string(), category: categoryEnum })).min(1),
});

builderRouter.put("/:id/questions/reorder", validateBody(reorderPayload), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  try {
    const kit = await applyEdit(kitDoc, (k) => reorderQuestions(k, req.body.items));
    res.json({ kit });
  } catch (err) {
    throw new ApiError(400, "VALIDATION_ERROR", err instanceof Error ? err.message : "Bad reorder");
  }
});

// ---- Flashcards ----
const flashcardPatch = z.object({
  front: z.string().min(1).optional(),
  back: z.string().optional(),
  requirement_ids: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

builderRouter.patch("/:id/flashcards/:fid", validateBody(flashcardPatch), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => editFlashcard(k, String(req.params.fid), req.body));
  res.json({ kit });
});

const newFlashcard = z.object({
  front: z.string().min(1),
  back: z.string().default(""),
  requirement_ids: z.array(z.string()).default([]),
});

builderRouter.post("/:id/flashcards", validateBody(newFlashcard), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => addFlashcard(k, req.body));
  res.status(201).json({ kit });
});

builderRouter.delete("/:id/flashcards/:fid", async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => deleteFlashcard(k, String(req.params.fid)));
  res.json({ kit });
});

// ---- Brief ----
const briefPatch = z.object({
  summary: z.string().optional(),
  what_they_do: z.string().optional(),
});

builderRouter.patch("/:id/brief", validateBody(briefPatch), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  const kit = await applyEdit(kitDoc, (k) => editBrief(k, req.body));
  res.json({ kit });
});

// ---- Regenerate a single section ----
const regeneratePayload = z.object({
  section: z.enum(["schedule", "company_brief", "questions"]),
  category: categoryEnum.optional(),
});

builderRouter.post("/:id/regenerate", validateBody(regeneratePayload), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  assertReady(kitDoc);
  const next = await regenerateSection(kitDoc, req.body);
  const { kit, issues } = validateKit(next);
  if (!kit) {
    throw new ApiError(422, "INVALID_EDIT", issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }
  kitDoc.kit = kit;
  kitDoc.markModified("kit");
  await kitDoc.save();
  res.json({ kit });
});
