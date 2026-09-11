import { GoogleGenAI } from "@google/genai";
import { normalizeProviderError } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

/** Primary provider. */
export class GeminiProvider implements LlmProvider {
  readonly name: string;
  private client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model = "gemini-2.5-flash",
    apiVersion = "v1",
  ) {
    this.name = `gemini:${model}`;
    this.client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion } });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      const res = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: req.jsonSchema,
          temperature: 0.4,
        },
      });
      const text = res.text ?? "";
      return { text, provider: this.name, model: this.model };
    } catch (err) {
      normalizeProviderError(err);
    }
  }
}
