import { generateText, Output } from 'ai';
import { z } from 'zod';

export const MODERATION_MODELS = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'openai/gpt-oss-safeguard-20b',
] as const;

export function sanitizeModerationText(value: unknown, maxChars = 1200) {
  const normalized = typeof value === 'string' ? value : value == null ? '' : String(value);
  const collapsed = normalized.replace(/\s+/g, ' ').trim();

  if (collapsed.length <= maxChars) {
    return collapsed;
  }

  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function chunkModerationItems<T>(items: T[], size: number) {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than zero');
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
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        prompt,
      });

      return output as z.output<TSchema>;
    } catch (error) {
      lastError = error;
      console.warn(`[${label}] moderation generation failed with ${model}:`, error);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`${label} failed for all moderation models`);
}