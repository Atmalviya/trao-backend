import { describe, expect, it } from "vitest";
import { hiringContentScore, rankLinks, scoreLink } from "../src/core/retrieval/linkRank.js";

describe("scoreLink", () => {
  it("scores a careers link high on hiring", () => {
    const s = scoreLink({ href: "https://co.test/careers", text: "Careers" });
    expect(s.hiring).toBeGreaterThan(0);
    expect(s.relevance).toBeGreaterThan(0);
  });

  it("scores an about link on the about axis", () => {
    const s = scoreLink({ href: "https://co.test/about", text: "About us" });
    expect(s.about).toBeGreaterThan(0);
  });

  it("recognises a hiring page at an unpredictable path via anchor text", () => {
    const s = scoreLink({
      href: "https://co.test/handbook/joining/interview-loop.html",
      text: "Joining Acme: our interview loop",
    });
    expect(s.hiring).toBeGreaterThan(0);
  });

  it("penalises legal/login pages below content pages", () => {
    const legal = scoreLink({ href: "https://co.test/privacy", text: "Privacy Policy" });
    const careers = scoreLink({ href: "https://co.test/careers", text: "Careers" });
    expect(careers.relevance).toBeGreaterThan(legal.relevance);
    expect(legal.relevance).toBeLessThanOrEqual(0);
  });
});

describe("rankLinks", () => {
  it("ranks the hiring link above about, and about above legal", () => {
    const ranked = rankLinks([
      { href: "https://co.test/privacy", text: "Privacy" },
      { href: "https://co.test/about", text: "About" },
      { href: "https://co.test/handbook/joining/interview-loop.html", text: "Our interview loop" },
    ]);
    expect(ranked[0]!.href).toContain("interview-loop");
    expect(ranked[1]!.href).toContain("about");
    expect(ranked[2]!.href).toContain("privacy");
  });
});

describe("hiringContentScore", () => {
  it("detects interview-process vocabulary in page text", () => {
    const text = "Our interview process includes a take-home and a system design interview.";
    expect(hiringContentScore(text)).toBeGreaterThanOrEqual(2);
  });
  it("is zero for unrelated text", () => {
    expect(hiringContentScore("We sell warehouse robots to retailers.")).toBe(0);
  });
});
