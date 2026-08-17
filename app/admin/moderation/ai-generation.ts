import { generateText, Output } from "ai";
import { z } from "zod";
import { prepareTrackedAiCall } from "@/lib/ai/with-ai-tracking";
import { AI_MODEL_FAST, AI_MODEL_QUALITY } from "@/lib/ai/models";

export const MODERATION_MODELS = [
  AI_MODEL_FAST,
  AI_MODEL_QUALITY,
  "openai/gpt-oss-safeguard-20b",
] as const;

export function sanitizeModerationText(value: unknown, maxChars = 1200) {
  const normalized =
    typeof value === "string" ? value : value == null ? "" : String(value);
  const collapsed = normalized.replace(/\s+/g, " ").trim();

  if (collapsed.length <= maxChars) {
    return collapsed;
  }

  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function chunkModerationItems<T>(items: T[], size: number) {
  if (size <= 0) {
    throw new Error("Chunk size must be greater than zero");
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

type GenerateModerationObjectOptions<TSchema extends z.ZodTypeAny> = {
  label: string;
  schema: TSchema;
  prompt: string;
  models?: readonly string[];
};

export async function generateModerationObject<TSchema extends z.ZodTypeAny>({
  label,
  schema,
  prompt,
  models = MODERATION_MODELS,
}: GenerateModerationObjectOptions<TSchema>): Promise<z.output<TSchema>> {
  let lastError: unknown;

  for (const model of models) {
    const tracked = prepareTrackedAiCall({
      context: { scope: "moderation", feature: label },
      modelId: model,
    });
    const startedAt = Date.now();
    try {
      const result = await generateText({
        model: tracked.model,
        experimental_telemetry: tracked.telemetry,
        providerOptions: { gateway: tracked.gatewayOptions },
        output: Output.object({ schema }),
        prompt,
      });
      await tracked.logUsage({
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      });

      return result.output as z.output<TSchema>;
    } catch {
      lastError = new Error(`${label} generation failed`);
      await tracked.logUsage({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: "generation_failed",
      });
      console.warn(`[${label}] moderation generation failed`);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`${label} failed for all moderation models`);
}
