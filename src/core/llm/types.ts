/** A single LLM completion request. */
export interface LlmRequest {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  label: string;
  estimatedTokens: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}
