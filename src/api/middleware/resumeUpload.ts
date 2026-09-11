import multer from "multer";
import { ApiError } from "../errors.js";

const MAX_BYTES = 5 * 1024 * 1024;

export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const name = file.originalname.toLowerCase();
    const ok =
      name.endsWith(".pdf") ||
      name.endsWith(".docx") ||
      name.endsWith(".txt") ||
      name.endsWith(".md");
    if (!ok) {
      cb(new Error("UNSUPPORTED_TYPE"));
      return;
    }
    cb(null, true);
  },
});

export function multerErrorHandler(err: unknown): never {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      throw new ApiError(413, "FILE_TOO_LARGE", "Resume must be under 5 MB.");
    }
    throw new ApiError(400, "UPLOAD_ERROR", err.message);
  }
  throw err;
}
