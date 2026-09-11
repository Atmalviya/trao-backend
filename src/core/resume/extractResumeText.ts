import mammoth from "mammoth";

export type ExtractionMethod = "plain" | "docx" | "pdf";

export interface ResumeExtraction {
  text: string;
  charCount: number;
  method: ExtractionMethod;
  warnings: string[];
}

const MAX_STORED_CHARS = 100_000;

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const ALLOWED_MIMES = new Set(Object.values(MIME_BY_EXT));

export class ResumeExtractionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResumeExtractionError";
  }
}

function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

/** Resolve MIME from declared type and file extension (both must agree with allowlist). */
export function resolveResumeMime(mimeType: string, fileName: string): string {
  const ext = extOf(fileName);
  const fromExt = MIME_BY_EXT[ext];
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (fromExt && ALLOWED_MIMES.has(fromExt)) {
    if (normalized && normalized !== fromExt && normalized !== "application/octet-stream") {
      throw new ResumeExtractionError(
        "UNSUPPORTED_TYPE",
        "File extension and content type do not match. Use PDF, DOCX, TXT, or MD.",
      );
    }
    return fromExt;
  }

  if (!ext && ALLOWED_MIMES.has(normalized)) return normalized;

  throw new ResumeExtractionError(
    "UNSUPPORTED_TYPE",
    "Unsupported file type. Use PDF, DOCX, TXT, or MD.",
  );
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text ?? "";
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

function extractPlain(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

/**
 * Extract plain text from an uploaded resume buffer.
 * Text-based PDFs and DOCX only — scanned/image PDFs return empty text.
 */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ResumeExtraction> {
  if (buffer.length === 0) {
    throw new ResumeExtractionError("EMPTY_FILE", "The uploaded file is empty.");
  }

  const resolved = resolveResumeMime(mimeType, fileName);
  const warnings: string[] = [];
  let text = "";
  let method: ExtractionMethod = "plain";

  if (resolved === "application/pdf") {
    method = "pdf";
    text = await extractPdf(buffer);
    if (text.replace(/\s+/g, "").length < 40) {
      warnings.push(
        "Very little text was extracted from this PDF — it may be scanned or image-based.",
      );
    }
  } else if (
    resolved ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    method = "docx";
    text = await extractDocx(buffer);
  } else {
    method = "plain";
    text = extractPlain(buffer);
  }

  text = text.replace(/\r\n/g, "\n").trim();

  if (!text) {
    throw new ResumeExtractionError(
      "NO_TEXT",
      "Could not extract readable text from this file. Try a text-based PDF or DOCX.",
    );
  }

  if (text.length > MAX_STORED_CHARS) {
    warnings.push(`Resume truncated to ${MAX_STORED_CHARS.toLocaleString()} characters.`);
    text = text.slice(0, MAX_STORED_CHARS);
  }

  return {
    text,
    charCount: text.length,
    method,
    warnings,
  };
}
