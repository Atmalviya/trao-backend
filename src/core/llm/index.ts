import { LlmClient } from "./client.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";
import { RateLimitedQueue, type RateLimitOptions } from "./queue.js";
import type { LlmProvider } from "./types.js";

export * from "./types.js";
export { LlmClient } from "./client.js";
export { RateLimitedQueue } from "./queue.js";

export interface LlmConfig {
  geminiApiKey?: string;
  groqApiKey?: string;
  rateLimit?: Partial<RateLimitOptions>;
}

/** Build the client from whatever credentials are configured. */
export function createLlmClient(cfg: LlmConfig): LlmClient {
  const providers: LlmProvider[] = [];
  if (cfg.geminiApiKey) providers.push(new GeminiProvider(cfg.geminiApiKey));
  if (cfg.groqApiKey) providers.push(new GroqProvider(cfg.groqApiKey));

  if (providers.length === 0) {
    throw new Error(
      "No LLM provider configured. Set GEMINI_API_KEY (preferred) or GROQ_API_KEY.",
    );
  }
  return new LlmClient(providers, new RateLimitedQueue(cfg.rateLimit));
}
