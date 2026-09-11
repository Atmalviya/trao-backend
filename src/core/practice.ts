import type { Flashcard } from "./schema/kit.js";

export interface CardProgress {
  cardId: string;
  confidence: number;
  timesSeen: number;
  lastSeenAt: Date;
}

export interface PracticeStats {
  total: number;
  seen: number;
  unseen: number;
  byConfidence: Record<number, number>;
  averageConfidence: number | null;
}

/**
 * Order the next practice session. 
 * session be ordered "by what they were least confident about", left open between a simple
 * confidence-weighted sort and full spaced repetition. We use a confidence-
 * weighted sort with two defensible refinements:
 *   1. never-seen cards come first (you cannot be confident about a card you
 *      have not seen, and this drives coverage);
 *   2. among seen cards, lowest confidence first, ties broken by least-recently
 *      seen so a session does not repeat the same few cards back to back.
 */
export function orderCardsForPractice(
  cards: Flashcard[],
  progress: Map<string, CardProgress>,
): Flashcard[] {
  return [...cards].sort((a, b) => {
    const pa = progress.get(a.id);
    const pb = progress.get(b.id);

    if (!pa && pb) return -1;
    if (pa && !pb) return 1;
    if (!pa && !pb) return a.id.localeCompare(b.id);

    if (pa!.confidence !== pb!.confidence) return pa!.confidence - pb!.confidence;

    const ta = pa!.lastSeenAt.getTime();
    const tb = pb!.lastSeenAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function practiceStats(cards: Flashcard[], progress: Map<string, CardProgress>): PracticeStats {
  const byConfidence: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let seen = 0;
  let confidenceSum = 0;
  for (const card of cards) {
    const p = progress.get(card.id);
    if (p) {
      seen++;
      byConfidence[p.confidence] = (byConfidence[p.confidence] ?? 0) + 1;
      confidenceSum += p.confidence;
    }
  }
  return {
    total: cards.length,
    seen,
    unseen: cards.length - seen,
    byConfidence,
    averageConfidence: seen > 0 ? confidenceSum / seen : null,
  };
}
