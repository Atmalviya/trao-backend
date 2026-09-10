import { z } from "zod";
import { extractJson } from "./json.js";
import { RateLimitedQueue, type RateLimitOptions } from "./queue.js";
import type { LlmProvider } from "./types.js";

export interface GenerateArgs<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  label: string;
  estimatedTokens?: number;
}

function estimateTokens(system: string, prompt: string): number {
  const input = Math.ceil((system.length + prompt.length) / 4);
  return input + 1_500;
}

/** The one place the pipeline talks to an LLM. */
export class LlmClient {
  constructor(
    private providers: LlmProvider[],
    private queue = new RateLimitedQueue(),
  ) {
    if (providers.length === 0) {
      throw new Error("LlmClient requires at least one provider");
    }
  }

  get primaryName(): string {
    return this.providers[0]!.name;
  }

  async generate<T>(args: GenerateArgs<T>): Promise<T> {
    const jsonSchema = z.toJSONSchema(args.schema, { target: "draft-7" }) as Record<
      string,
      unknown
    >;
    const estimated = args.estimatedTokens ?? estimateTokens(args.system, args.prompt);

    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await this.tryProvider(provider, args, jsonSchema, estimated);
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `All LLM providers failed for "${args.label}": ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private async tryProvider<T>(
    provider: LlmProvider,
    args: GenerateArgs<T>,
    jsonSchema: Record<string, unknown>,
    estimated: number,
  ): Promise<T> {
    const first = await this.queue.run(estimated, () =>
      provider.complete({
        system: args.system,
        prompt: args.prompt,
        jsonSchema,
        label: args.label,
        estimatedTokens: estimated,
      }),
    );

    const parsed = this.parse(first.text, args.schema);
    if (parsed.ok) return parsed.value;

    const repairPrompt = [
      "Your previous response did not satisfy the required schema.",
      `Errors:\n${parsed.errors}`,
      `Your previous response was:\n${first.text}`,
      "Return corrected JSON only, matching the schema exactly.",
    ].join("\n\n");

    const repaired = await this.queue.run(estimated, () =>
      provider.complete({
        system: args.system,
        prompt: `${args.prompt}\n\n${repairPrompt}`,
        jsonSchema,
        label: `${args.label}:repair`,
        estimatedTokens: estimated,
      }),
    );

    const reparsed = this.parse(repaired.text, args.schema);
    if (reparsed.ok) return reparsed.value;
    throw new Error(`Schema validation failed after repair: ${reparsed.errors}`);
  }

  private parse<T>(
    text: string,
    schema: z.ZodType<T>,
  ): { ok: true; value: T } | { ok: false; errors: string } {
    let json: unknown;
    try {
      json = JSON.parse(extractJson(text));
    } catch (err) {
      return { ok: false, errors: `Not valid JSON: ${(err as Error).message}` };
    }
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      errors: result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
}
