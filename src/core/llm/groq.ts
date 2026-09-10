import Groq from "groq-sdk";
import { normalizeProviderError } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

/** Fallback provider. */
export class GroqProvider implements LlmProvider {
  readonly name = "groq";
  private client: Groq;

  constructor(
    apiKey: string,
    readonly model = "llama-3.3-70b-versatile",
  ) {
    this.client = new Groq({ apiKey });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const system = `${req.system}\n\nReturn ONLY JSON matching this JSON Schema:\n${JSON.stringify(
      req.jsonSchema,
    )}`;
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: req.prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      });
      const text = res.choices[0]?.message?.content ?? "";
      return { text, provider: this.name, model: this.model };
    } catch (err) {
      normalizeProviderError(err);
    }
  }
}
