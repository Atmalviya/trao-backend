import { config } from "../../config.js";
import { createLlmClient, type LlmClient } from "../../core/llm/index.js";

let client: LlmClient | null = null;

/** Memoised LLM client shared across requests (one rate-limit queue process-wide). */
export function getLlm(): LlmClient {
  if (!client) {
    client = createLlmClient({
      geminiApiKey: config.GEMINI_API_KEY,
      geminiModel: config.GEMINI_MODEL,
      geminiApiVersion: config.GEMINI_API_VERSION,
      groqApiKey: config.GROQ_API_KEY,
      groqModel: config.GROQ_MODEL,
    });
  }
  return client;
}
