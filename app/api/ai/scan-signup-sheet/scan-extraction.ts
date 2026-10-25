import { generateText, Output } from "ai";
import { safeConsole } from "@/lib/safe-console";
import { prepareTrackedAiCall } from "@/lib/ai/with-ai-tracking";
import { AI_MODEL_FALLBACK_CHAIN } from "@/lib/ai/models";
import {
  paperSignupExtractionSchema,
  shouldEscalatePaperScan,
  type PaperSignupExtraction,
} from "@/lib/ai/paper-signup-schema";

/**
 * The escalation ladder. Tier 0 handles clean sheets at ~1/5 the cost;
 * tier 1 re-reads images the cheap tier could not transcribe confidently
 * (see shouldEscalatePaperScan) and doubles as the availability fallback.
 */
const PAPER_SCAN_MODELS = AI_MODEL_FALLBACK_CHAIN;

const MAX_OUTPUT_TOKENS = 8000;
const MODEL_CALL_TIMEOUT_MS = 45 * 1000;

interface ExtractionAttempt {
  extraction: PaperSignupExtraction | null;
  modelId: string | null;
  modelsTried: string[];
}

async function extractImageWithModel(options: {
  modelId: string;
  prompt: string;
  imageBytes: Uint8Array;
  mediaType: string;
  userId: string;
  organizationId: string | undefined;
  deadlineMs: number;
}): Promise<PaperSignupExtraction | null> {
  const tracked = prepareTrackedAiCall({
    context: {
      scope: "platform",
      userId: options.userId,
      organizationId: options.organizationId,
      feature: "paper-signup-scan",
    },
    modelId: options.modelId,
  });

  const startedAt = Date.now();
  try {
    const remainingMs = options.deadlineMs - startedAt;
    if (remainingMs <= 0) return null;

    const result = await generateText({
      model: tracked.model,
      experimental_telemetry: tracked.telemetry,
      providerOptions: { gateway: tracked.gatewayOptions },
      output: Output.object({ schema: paperSignupExtractionSchema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            {
              type: "file",
              data: options.imageBytes,
              mediaType: options.mediaType,
            },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The model ladder already supplies an availability fallback. Disabling
      // hidden SDK retries keeps a ten-page scan inside the route budget, and
      // the per-call timeout prevents one provider request from stranding the
      // durable batch in `extracting` until its lease expires.
      maxRetries: 0,
      timeout: Math.min(MODEL_CALL_TIMEOUT_MS, remainingMs),
    });

    await tracked.logUsage({
      promptTokens: result.usage?.inputTokens,
      completionTokens: result.usage?.outputTokens,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    const parsed = paperSignupExtractionSchema.safeParse(result.output);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    safeConsole.error(
      "Application diagnostic from app/api/ai/scan-signup-sheet/route",
      `Paper scan extraction failed on ${options.modelId}:`,
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    await tracked.logUsage({
      latencyMs: Date.now() - startedAt,
      success: false,
      errorMessage: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/**
 * Tier 0 first; escalate to tier 1 when the cheap read is doubtful and take
 * the stronger result wholesale. A model that errors falls through to the
 * next tier, so one bad model id degrades cost, never availability.
 */
export async function extractImage(options: {
  prompt: string;
  imageBytes: Uint8Array;
  mediaType: string;
  userId: string;
  organizationId: string | undefined;
  deadlineMs: number;
}): Promise<ExtractionAttempt> {
  const modelsTried: string[] = [];
  let best: PaperSignupExtraction | null = null;
  let bestModel: string | null = null;

  for (const modelId of PAPER_SCAN_MODELS) {
    if (Date.now() >= options.deadlineMs) break;
    modelsTried.push(modelId);
    const extraction = await extractImageWithModel({ ...options, modelId });

    if (extraction) {
      best = extraction;
      bestModel = modelId;
      if (!shouldEscalatePaperScan(extraction)) break;
      // Doubtful read: continue to the stronger tier, keeping this result
      // as the fallback if the escalation itself fails.
      continue;
    }
  }

  return { extraction: best, modelId: bestModel, modelsTried };
}
