import { describe, expect, it } from "vitest";
import { orderCardsForPractice, practiceStats, type CardProgress } from "../src/core/practice.js";
import type { Flashcard } from "../src/core/schema/kit.js";

function card(id: string): Flashcard {
  return { id, front: `front ${id}`, back: "back", requirement_ids: [], origin: "generated", pinned: false };
}

const cards = [card("f1"), card("f2"), card("f3"), card("f4")];

describe("orderCardsForPractice", () => {
  it("puts unseen cards before seen ones", () => {
    const progress = new Map<string, CardProgress>([
      ["f1", { cardId: "f1", confidence: 2, timesSeen: 1, lastSeenAt: new Date() }],
    ]);
    const ordered = orderCardsForPractice(cards, progress).map((c) => c.id);
    expect(ordered.indexOf("f2")).toBeLessThan(ordered.indexOf("f1"));
  });

  it("orders seen cards by lowest confidence first", () => {
    const now = Date.now();
    const progress = new Map<string, CardProgress>([
      ["f1", { cardId: "f1", confidence: 4, timesSeen: 1, lastSeenAt: new Date(now) }],
      ["f2", { cardId: "f2", confidence: 1, timesSeen: 1, lastSeenAt: new Date(now) }],
      ["f3", { cardId: "f3", confidence: 2, timesSeen: 1, lastSeenAt: new Date(now) }],
      ["f4", { cardId: "f4", confidence: 3, timesSeen: 1, lastSeenAt: new Date(now) }],
    ]);
    expect(orderCardsForPractice(cards, progress).map((c) => c.id)).toEqual(["f2", "f3", "f4", "f1"]);
  });

  it("breaks confidence ties by least-recently-seen", () => {
    const progress = new Map<string, CardProgress>([
      ["f1", { cardId: "f1", confidence: 2, timesSeen: 1, lastSeenAt: new Date(2000) }],
      ["f2", { cardId: "f2", confidence: 2, timesSeen: 1, lastSeenAt: new Date(1000) }],
      ["f3", { cardId: "f3", confidence: 2, timesSeen: 1, lastSeenAt: new Date(3000) }],
      ["f4", { cardId: "f4", confidence: 2, timesSeen: 1, lastSeenAt: new Date(500) }],
    ]);
    expect(orderCardsForPractice(cards, progress).map((c) => c.id)).toEqual(["f4", "f2", "f1", "f3"]);
  });
});

describe("practiceStats", () => {
  it("reports coverage and average confidence", () => {
    const progress = new Map<string, CardProgress>([
      ["f1", { cardId: "f1", confidence: 2, timesSeen: 1, lastSeenAt: new Date() }],
      ["f2", { cardId: "f2", confidence: 4, timesSeen: 1, lastSeenAt: new Date() }],
    ]);
    const stats = practiceStats(cards, progress);
    expect(stats.total).toBe(4);
    expect(stats.seen).toBe(2);
    expect(stats.unseen).toBe(2);
    expect(stats.byConfidence[2]).toBe(1);
    expect(stats.byConfidence[4]).toBe(1);
    expect(stats.averageConfidence).toBe(3);
  });

  it("reports null average when nothing has been seen", () => {
    expect(practiceStats(cards, new Map()).averageConfidence).toBeNull();
  });
});
