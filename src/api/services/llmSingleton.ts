import { config } from "../../config.js";
import { createLlmClient, type LlmClient } from "../../core/llm/index.js";

let client: LlmClient | null = null;

/** Memoised LLM client shared across requests. */
export function getLlm(): LlmClient {
  if (!client) {
    client = createLlmClient({
      geminiApiKey: config.GEMINI_API_KEY,
      groqApiKey: config.GROQ_API_KEY,
    });
  }
  return client;
}
