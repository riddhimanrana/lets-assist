import { randomUUID } from "node:crypto";
import { generateText, Output } from "ai";
import { NextRequest } from "next/server";
import { z } from "zod";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { prepareTrackedAiCall } from "@/lib/ai/with-ai-tracking";
import {
  paperSignupExtractionSchema,
  shouldEscalatePaperScan,
  type PaperSignupExtraction,
  type PaperSignupRow,
} from "@/lib/ai/paper-signup-schema";
import { AI_MODEL_FALLBACK_CHAIN } from "@/lib/ai/models";
import { buildPaperSignupExtractionPrompt } from "@/lib/ai/paper-signup-prompt";
import {
  normalizeTimeString,
  resolveRowWindow,
} from "@/lib/projects/paper-signup/normalize";
import {
  MATCH_AUTO_THRESHOLD,
  matchPaperRow,
  normalizeEmail,
  type PaperMatchCandidate,
} from "@/lib/projects/paper-signup/matching";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import type { Project } from "@/types";

// Ten sequential vision calls plus escalations exceed the default timeout.
// Node runtime only: edge is incompatible with cacheComponents.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The escalation ladder. Tier 0 handles clean sheets at ~1/5 the cost;
 * tier 1 re-reads images the cheap tier could not transcribe confidently
 * (see shouldEscalatePaperScan) and doubles as the availability fallback.
 */
const PAPER_SCAN_MODELS = AI_MODEL_FALLBACK_CHAIN;

const SCAN_USER_LIMIT = 6;
const SCAN_IP_LIMIT = 20;
const SCAN_PROJECT_LIMIT = 10;
const SCAN_WINDOW_SECONDS = 3600;
const MAX_OUTPUT_TOKENS = 8000;
const EXTRACTION_LEASE_MS = 10 * 60 * 1000;
/** Auto-include requires a confidently-read email; below this the reviewer decides. */
const EMAIL_AUTO_INCLUDE_CONFIDENCE = 0.8;

const scanRequestSchema = z
  .object({
    batchId: z.string().uuid(),
  })
  .strict();

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
    console.error(
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
async function extractImage(options: {
  prompt: string;
  imageBytes: Uint8Array;
  mediaType: string;
  userId: string;
  organizationId: string | undefined;
}): Promise<ExtractionAttempt> {
  const modelsTried: string[] = [];
  let best: PaperSignupExtraction | null = null;
  let bestModel: string | null = null;

  for (const modelId of PAPER_SCAN_MODELS) {
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

type StagedRowInsert = {
  batch_id: string;
  project_id: string;
  image_id: string;
  sheet_row_number: number;
  raw_extraction: PaperSignupRow;
  overall_confidence: number;
  model_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  signature_present: boolean;
  match_kind: string;
  match_signup_id: string | null;
  match_user_id: string | null;
  match_anonymous_id: string | null;
  match_score: number | null;
  match_reasons: string[];
  decision: string;
  outcome_detail: string | null;
};

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  let claimedBatch: { id: string; claimId: string } | null = null;

  try {
    const { user, error: authError } = await getAuthUser({ sensitive: true });
    if (authError || !user) {
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const parsedRequest = scanRequestSchema.safeParse(
      await req.json().catch(() => null),
    );
    if (!parsedRequest.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const { batchId } = parsedRequest.data;

    const { data: batch, error: batchError } = await admin
      .from("project_paper_scan_batches")
      .select(
        "id, project_id, schedule_id, status, updated_at, projects(id, creator_id, organization_id, can_be_managed_by_staff, event_type, schedule, project_timezone, title)",
      )
      .eq("id", batchId)
      .single();

    if (batchError || !batch || !batch.projects) {
      return Response.json({ error: "Batch not found" }, { status: 404 });
    }
    const project = batch.projects as unknown as Project & {
      organization_id: string | null;
      can_be_managed_by_staff: boolean | null;
    };

    let organizationRole: string | null = null;
    if (project.organization_id && project.creator_id !== user.id) {
      const { data: membership } = await admin
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", project.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      organizationRole = activeOrganizationRole(membership);
    }

    if (
      !canManageProjectAccess({
        creatorId: project.creator_id,
        userId: user.id,
        organizationRole,
        canBeManagedByStaff: project.can_be_managed_by_staff ?? false,
      })
    ) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    if (!["draft", "failed", "extracting"].includes(batch.status)) {
      return Response.json(
        { error: "This batch has already been extracted." },
        { status: 409 },
      );
    }
    if (
      batch.status === "extracting" &&
      new Date(batch.updated_at).getTime() > Date.now() - EXTRACTION_LEASE_MS
    ) {
      return Response.json(
        { error: "This batch is already being scanned." },
        { status: 409 },
      );
    }

    const requestIp = getRequestIp(req.headers);
    const quota = await consumeAiQuota({
      feature: "paper-signup-scan",
      windowSeconds: SCAN_WINDOW_SECONDS,
      buckets: [
        { scope: "user", identifier: user.id, limit: SCAN_USER_LIMIT },
        ...(requestIp
          ? [
              {
                scope: "ip",
                identifier: requestIp,
                limit: SCAN_IP_LIMIT,
              },
            ]
          : []),
        {
          scope: "project",
          identifier: batch.project_id,
          limit: SCAN_PROJECT_LIMIT,
        },
      ],
    });
    if (!quota.allowed) {
      const retryAfterSeconds = Math.max(
        Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1_000),
        1,
      );
      return Response.json(
        { error: "Too many scans right now. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": retryAfterSeconds.toString() },
        },
      );
    }

    const window = getAttendanceScheduleWindow(project, batch.schedule_id);
    if (!window) {
      return Response.json(
        { error: "This slot's schedule could not be resolved." },
        { status: 422 },
      );
    }
    const timezone = project.project_timezone || "America/Los_Angeles";

    const { data: images, error: imagesError } = await admin
      .from("project_paper_scan_images")
      .select("id, object_path, content_type, sequence")
      .eq("batch_id", batchId)
      .order("sequence");
    if (imagesError || !images || images.length === 0) {
      return Response.json(
        { error: "This batch has no photos to scan." },
        { status: 422 },
      );
    }

    const claimId = randomUUID();
    const { data: claimed, error: claimError } = await admin
      .from("project_paper_scan_batches")
      .update({
        status: "extracting",
        extraction_error: null,
        extraction_claim_id: claimId,
      })
      .eq("id", batchId)
      .eq("status", batch.status)
      .eq("updated_at", batch.updated_at)
      .select("id")
      .maybeSingle();
    if (claimError) {
      throw new Error(`Failed to claim scan batch: ${claimError.code}`);
    }
    if (!claimed) {
      return Response.json(
        { error: "This batch is already being scanned." },
        { status: 409 },
      );
    }
    claimedBatch = { id: batchId, claimId };
    // Idempotent restart after a crash: clear any partial staging rows.
    await admin
      .from("project_paper_scan_rows")
      .delete()
      .eq("batch_id", batchId);

    const slotStart = new Date(window.startsAt);
    const prompt = buildPaperSignupExtractionPrompt({
      projectTitle: project.title,
      slotLabel: batch.schedule_id,
      slotDate: slotStart.toLocaleDateString("en-CA", { timeZone: timezone }),
      slotStart: slotStart.toLocaleTimeString("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
      slotEnd: new Date(window.endsAt).toLocaleTimeString("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
      timezone,
    });

    // Candidate identities for fuzzy matching: every signup on this project
    // (any slot — people sign the wrong sheet), plus anonymous identities.
    // Never a global name search; cross-tenant identity lookups are only by
    // exact email, inside the commit RPC.
    const [{ data: signupCandidates }, { data: anonCandidates }] =
      await Promise.all([
        admin
          .from("project_signups")
          .select(
            "id, user_id, anonymous_id, created_at, profiles(full_name, email, phone), anonymous_signups(name, email, phone_number)",
          )
          .eq("project_id", batch.project_id)
          .neq("status", "rejected")
          .order("created_at"),
        admin
          .from("anonymous_signups")
          .select("id, name, email, phone_number, created_at")
          .eq("project_id", batch.project_id)
          .order("created_at"),
      ]);

    const candidates: PaperMatchCandidate[] = [];
    for (const signup of signupCandidates ?? []) {
      const profile = signup.profiles as unknown as {
        full_name: string | null;
        email: string | null;
        phone: string | null;
      } | null;
      const anon = signup.anonymous_signups as unknown as {
        name: string | null;
        email: string | null;
        phone_number: string | null;
      } | null;
      candidates.push({
        signupId: signup.id,
        userId: signup.user_id,
        anonymousId: signup.anonymous_id,
        name: profile?.full_name ?? anon?.name ?? null,
        email: profile?.email ?? anon?.email ?? null,
        phone: profile?.phone ?? anon?.phone_number ?? null,
      });
    }
    const linkedAnonIds = new Set(
      candidates.map((candidate) => candidate.anonymousId).filter(Boolean),
    );
    for (const anon of anonCandidates ?? []) {
      if (linkedAnonIds.has(anon.id)) continue;
      candidates.push({
        signupId: null,
        userId: null,
        anonymousId: anon.id,
        name: anon.name,
        email: anon.email,
        phone: anon.phone_number,
      });
    }

    const warnings: string[] = [];
    const modelsUsed = new Set<string>();
    const stagedRows: StagedRowInsert[] = [];
    const seenIdentities: Array<{
      sheetRowNumber: number;
      name: string | null;
      email: string | null;
      phone: string | null;
    }> = [];
    let imagesProcessed = 0;
    let nextRowNumber = 1;

    for (const image of images) {
      const { data: blob, error: downloadError } = await admin.storage
        .from("paper-signup-scans")
        .download(image.object_path);
      if (downloadError || !blob) {
        warnings.push(`image_${image.sequence}_unreadable`);
        continue;
      }

      const attempt = await extractImage({
        prompt,
        imageBytes: new Uint8Array(await blob.arrayBuffer()),
        mediaType: image.content_type,
        userId: user.id,
        organizationId: project.organization_id ?? undefined,
      });
      attempt.modelsTried.forEach((model) => modelsUsed.add(model));

      if (!attempt.extraction) {
        warnings.push(`image_${image.sequence}_failed`);
        continue;
      }
      imagesProcessed += 1;
      if (!attempt.extraction.sheetLegible) {
        warnings.push(`image_${image.sequence}_illegible`);
      }
      if (attempt.extraction.rows.length === 0) {
        warnings.push(`image_${image.sequence}_no_rows`);
      }
      if (attempt.modelsTried.length > 1) {
        warnings.push(`image_${image.sequence}_escalated`);
      }

      for (const row of attempt.extraction.rows) {
        const email = normalizeEmail(row.email.value);
        const name = row.name.value?.trim() || null;
        const phone = row.phone.value?.trim() || null;

        const resolved = resolveRowWindow({
          window,
          timezone,
          timeIn: normalizeTimeString(row.timeIn.value),
          timeOut: normalizeTimeString(row.timeOut.value),
        });

        const match = matchPaperRow({ name, email, phone }, candidates);

        // Same person transcribed twice in this batch: flag for the reviewer.
        const duplicateOf = seenIdentities.find(
          (seen) =>
            (email && seen.email && email === seen.email) ||
            matchPaperRow({ name, email: null, phone }, [
              {
                signupId: null,
                userId: null,
                anonymousId: null,
                name: seen.name,
                email: null,
                phone: seen.phone,
              },
            ]).score >= MATCH_AUTO_THRESHOLD,
        );
        seenIdentities.push({
          sheetRowNumber: nextRowNumber,
          name,
          email,
          phone,
        });

        const emailDoubtful =
          email !== null &&
          row.email.confidence < EMAIL_AUTO_INCLUDE_CONFIDENCE;
        const autoInclude =
          !duplicateOf && !emailDoubtful && (name !== null || email !== null);

        stagedRows.push({
          batch_id: batchId,
          project_id: batch.project_id,
          image_id: image.id,
          sheet_row_number: nextRowNumber,
          raw_extraction: row,
          overall_confidence: row.rowConfidence,
          model_id: attempt.modelId,
          name,
          email,
          phone,
          check_in_time: resolved
            ? new Date(resolved.checkInMs).toISOString()
            : null,
          check_out_time: resolved
            ? new Date(resolved.checkOutMs).toISOString()
            : null,
          signature_present: row.signaturePresent,
          match_kind: match.kind,
          match_signup_id: match.signupId,
          match_user_id: match.userId,
          match_anonymous_id: match.anonymousId,
          match_score: match.score > 0 ? match.score : null,
          match_reasons: match.reasons,
          decision: autoInclude ? "include" : "pending",
          outcome_detail: duplicateOf
            ? `duplicate_of_row_${duplicateOf.sheetRowNumber}`
            : null,
        });
        nextRowNumber += 1;
      }
    }

    if (imagesProcessed === 0) {
      const { data: failedBatch, error: failError } = await admin
        .from("project_paper_scan_batches")
        .update({
          status: "failed",
          extraction_error: "no_images_extracted",
          models_used: [...modelsUsed],
          extraction_claim_id: null,
        })
        .eq("id", batchId)
        .eq("extraction_claim_id", claimId)
        .select("id")
        .maybeSingle();
      if (failError || !failedBatch) {
        throw new Error(
          `Failed to settle unreadable scan: ${failError?.code ?? "claim_lost"}`,
        );
      }
      claimedBatch = null;
      return Response.json(
        { error: "None of the photos could be read. Try clearer photos." },
        { status: 422 },
      );
    }

    if (stagedRows.length > 0) {
      const { error: insertError } = await admin
        .from("project_paper_scan_rows")
        .insert(stagedRows);
      if (insertError) {
        throw new Error(`Failed to stage rows: ${insertError.code}`);
      }
    }

    const { data: reviewBatch, error: reviewError } = await admin
      .from("project_paper_scan_batches")
      .update({
        status: "review",
        extracted_row_count: stagedRows.length,
        models_used: [...modelsUsed],
        extracted_at: new Date().toISOString(),
        extraction_claim_id: null,
      })
      .eq("id", batchId)
      .eq("extraction_claim_id", claimId)
      .select("id")
      .maybeSingle();
    if (reviewError || !reviewBatch) {
      throw new Error(
        `Failed to settle extracted scan: ${reviewError?.code ?? "claim_lost"}`,
      );
    }
    claimedBatch = null;

    return Response.json({
      batchId,
      rowCount: stagedRows.length,
      imagesProcessed,
      modelsUsed: [...modelsUsed],
      warnings,
    });
  } catch (error) {
    console.error("Paper signup scan failed:", error);
    if (claimedBatch) {
      await admin
        .from("project_paper_scan_batches")
        .update({
          status: "failed",
          extraction_error: "extraction_crashed",
          extraction_claim_id: null,
        })
        .eq("id", claimedBatch.id)
        .eq("extraction_claim_id", claimedBatch.claimId);
    }
    return Response.json(
      { error: "Scanning failed. Please try again." },
      { status: 500 },
    );
  }
}
