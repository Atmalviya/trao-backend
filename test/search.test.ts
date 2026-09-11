import { describe, expect, it } from "vitest";
import {
  ambitionBoxInterviewsUrl,
  ambitionBoxSlugFromCompany,
  scoreJobProfileMatch,
  selectAmbitionBoxInterviewsForRole,
} from "../src/core/retrieval/ambitionbox.js";

describe("ambitionBoxSlugFromCompany", () => {
  it("derives slug from company URL hostname", () => {
    expect(ambitionBoxSlugFromCompany("Ignored", "https://www.akamai.com/careers")).toBe("akamai");
    expect(ambitionBoxSlugFromCompany("Trao", "https://trao.ai/")).toBe("trao");
  });

  it("normalises display name when URL is missing", () => {
    expect(ambitionBoxSlugFromCompany("Akamai Technologies")).toBe("akamai-technologies");
  });
});

describe("scoreJobProfileMatch", () => {
  const pmRole = { roleTitle: "Senior Product Manager", seniority: "senior" };

  it("ranks matching product profiles above unrelated engineering profiles", () => {
    expect(scoreJobProfileMatch("Senior Product Manager", pmRole)).toBeGreaterThan(
      scoreJobProfileMatch("Software Engineer", pmRole),
    );
    expect(scoreJobProfileMatch("Product Manager", pmRole)).toBeGreaterThan(
      scoreJobProfileMatch("QA Engineer", pmRole),
    );
  });

  it("penalises intern profiles for senior roles", () => {
    expect(scoreJobProfileMatch("Software Engineer", pmRole)).toBeGreaterThan(
      scoreJobProfileMatch("Summer Intern", pmRole),
    );
  });
});

describe("selectAmbitionBoxInterviewsForRole", () => {
  it("prefers questions tagged with matching job profiles", () => {
    const role = { roleTitle: "Software Engineer", seniority: "senior" };
    const items = [
      {
        question: "Why is a CDN needed?",
        jobProfile: "DevOps Site Reliability Engineer",
        questionUrl: "why-is-a-cdn-needed-blad2RQ3m",
      },
      {
        question: "Reverse a linked list",
        jobProfile: "Software Engineer",
        jobProfileUrl: "software-engineer",
        questionUrl: "reverse-linked-list-abc",
      },
      {
        question: "Tell me about yourself",
        jobProfile: "Intern",
        questionUrl: "tell-me-about-yourself-def",
      },
    ];

    const { results, matchedProfiles } = selectAmbitionBoxInterviewsForRole(
      items,
      "akamai",
      role,
      5,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.jobProfile).toBe("Software Engineer");
    expect(matchedProfiles).toContain("Software Engineer");
    expect(results.some((r) => r.jobProfile === "Intern")).toBe(false);
  });

  it("maps question URLs and includes profile in snippet", () => {
    const { results } = selectAmbitionBoxInterviewsForRole(
      [
        {
          question: "Why is a CDN needed?",
          jobProfile: "DevOps Site Reliability Engineer",
          questionUrl: "why-is-a-cdn-needed-blad2RQ3m",
        },
      ],
      "akamai",
      { roleTitle: "DevOps Site Reliability Engineer", seniority: "senior" },
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.snippet).toContain("DevOps Site Reliability Engineer");
    expect(results[0]!.url).toBe(
      `${ambitionBoxInterviewsUrl("akamai")}/why-is-a-cdn-needed-blad2RQ3m`,
    );
  });
});
