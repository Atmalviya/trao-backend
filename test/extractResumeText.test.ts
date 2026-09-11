import { describe, expect, it } from "vitest";
import {
  extractResumeText,
  resolveResumeMime,
  ResumeExtractionError,
} from "../src/core/resume/extractResumeText.js";

describe("resolveResumeMime", () => {
  it("accepts txt and md extensions", () => {
    expect(resolveResumeMime("text/plain", "resume.txt")).toBe("text/plain");
    expect(resolveResumeMime("", "notes.md")).toBe("text/markdown");
  });

  it("rejects unknown extensions", () => {
    expect(() => resolveResumeMime("application/pdf", "resume.doc")).toThrow(ResumeExtractionError);
  });
});

describe("extractResumeText", () => {
  it("extracts plain text from a UTF-8 buffer", async () => {
    const buf = Buffer.from("Senior Engineer\n5 years Node.js experience", "utf8");
    const result = await extractResumeText(buf, "text/plain", "resume.txt");
    expect(result.method).toBe("plain");
    expect(result.text).toContain("Node.js");
    expect(result.charCount).toBeGreaterThan(10);
  });

  it("rejects empty files", async () => {
    await expect(extractResumeText(Buffer.alloc(0), "text/plain", "empty.txt")).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });
});
