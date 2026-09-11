import { Router } from "express";
import { z } from "zod";
import {
  orderCardsForPractice,
  practiceStats,
  type CardProgress,
} from "../../core/practice.js";
import { ApiError } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateBody } from "../middleware/validate.js";
import { PracticeState } from "../models/PracticeState.js";
import { assertReady, ownedKit } from "../services/ownership.js";

export const practiceRouter = Router();
practiceRouter.use(requireAuth);

/** Build a cardId → progress map from the stored practice state. */
async function progressMap(userId: string, kitId: string): Promise<Map<string, CardProgress>> {
  const state = await PracticeState.findOne({ userId, kitId });
  const map = new Map<string, CardProgress>();
  for (const c of state?.cards ?? []) {
    map.set(c.cardId, {
      cardId: c.cardId,
      confidence: c.confidence,
      timesSeen: c.timesSeen,
      lastSeenAt: c.lastSeenAt,
    });
  }
  return map;
}

// Next session: flashcards ordered least-confident-first, plus coverage stats.
practiceRouter.get("/:id/practice", async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  assertReady(kitDoc);
  const cards = kitDoc.kit.flashcards;
  const progress = await progressMap(req.session.userId!, kitDoc.id);
  res.json({
    cards: orderCardsForPractice(cards, progress),
    stats: practiceStats(cards, progress),
    progress: Object.fromEntries(progress),
  });
});

const recordSchema = z.object({ confidence: z.number().int().min(1).max(4) });

// Record how confident the user felt on a card.
practiceRouter.post("/:id/practice/:cardId", validateBody(recordSchema), async (req, res) => {
  const kitDoc = await ownedKit(req.session.userId!, String(req.params.id));
  assertReady(kitDoc);
  const cardId = String(req.params.cardId);
  if (!kitDoc.kit.flashcards.some((f) => f.id === cardId)) {
    throw new ApiError(404, "NOT_FOUND", "Flashcard not found in this kit");
  }
  const { confidence } = req.body as z.infer<typeof recordSchema>;

  const state =
    (await PracticeState.findOne({ userId: req.session.userId, kitId: kitDoc.id })) ??
    new PracticeState({ userId: req.session.userId, kitId: kitDoc.id, cards: [] });

  const existing = state.cards.find((c) => c.cardId === cardId);
  if (existing) {
    existing.confidence = confidence;
    existing.timesSeen += 1;
    existing.lastSeenAt = new Date();
  } else {
    state.cards.push({ cardId, confidence, timesSeen: 1, lastSeenAt: new Date() });
  }
  await state.save();

  const progress = await progressMap(req.session.userId!, kitDoc.id);
  res.json({ stats: practiceStats(kitDoc.kit.flashcards, progress) });
});
