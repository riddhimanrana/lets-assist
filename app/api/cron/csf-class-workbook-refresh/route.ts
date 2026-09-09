import "server-only";
import { isCsfWorkerEnabled } from "@/lib/cron/csf-worker-controls";

import { createHash, timingSafeEqual } from "node:crypto";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { linkCsfClassSheetAction } from "@/lib/plugins/private/plugins/dvhs-csf/server/actions/class-sheet-sync";
import { type CsfClassWorkbookWorkerContext } from "@/lib/plugins/private/plugins/dvhs-csf/services/class-workbook-worker-context";
import { prepareNextCsfAutomaticApplicationSheet } from "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-application-sheet-refresh";
import { checkNextCsfAutomaticClassWorkbook } from "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-class-workbook-check";
import { dispatchCsfAutomaticClassPreviews } from "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-class-preview-dispatch";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;
const claimSchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(false) }),
  z.object({
    claimed: z.literal(true),
    jobId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    organizationId: z.string().uuid(),
    cohortId: z.string().uuid(),
    workbookId: z.string().uuid(),
    driveFileId: z.string().min(1),
    ownerUserId: z.string().uuid(),
    providerVersion: z.string().regex(/^[1-9][0-9]{0,18}$/u),
  }),
]);
const finishSchema = z.object({
  finished: z.literal(true),
  status: z.enum(["completed", "needs_reconnect", "blocked", "failed"]),
});
const applicationResultSchema = z.object({
  status: z.enum([
    "idle",
    "unchanged",
    "prepared",
    "needs_reconnect",
    "blocked",
    "retryable",
    "unknown",
  ]),
  claimed: z.number().int().min(0).max(1),
  prepared: z.number().int().min(0).max(1),
});

const metadataResultSchema = z.object({
  status: z.enum([
    "idle",
    "queued",
    "unchanged",
    "needs_reconnect",
    "blocked",
    "retryable",
    "unknown",
  ]),
  claimed: z.number().int().min(0).max(1),
  queued: z.number().int().min(0).max(1),
});

const dispatchResultSchema = z.object({
  checked: z.number().int().min(0).max(8),
  queued: z.number().int().min(0).max(8),
  needsAttention: z.number().int().min(0).max(8),
  blocked: z.number().int().min(0).max(8),
  unknown: z.number().int().min(0).max(1),
});

function secretsMatch(expected: string, presented: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const presentedDigest = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  const match = typeof header === "string" ? BEARER_GRAMMAR.exec(header) : null;
  if (!match) return false;
  const allowed = [
    process.env.CSF_WORKBOOK_WORKER_SECRET_TOKEN,
    process.env.CRON_TOKEN ?? process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));
  if (allowed.length === 0) return false;
  return allowed.reduce(
    (authorized, expected) => secretsMatch(expected, match[1]) || authorized,
    false,
  );
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control":
        "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  const probe = cronAuthShapeProbe("csf-class-workbook-refresh", request);
  if (probe) return probe;
  if (!(await isCsfWorkerEnabled("workbook_refresh"))) {
    return json({ enabled: false, claimed: 0, prepared: 0, blocked: 0 });
  }
  const workerSecret = process.env.CSF_WORKBOOK_WORKER_SECRET_TOKEN;
  if (!workerSecret) {
    return json({ error: "Workbook worker secret unavailable" }, 503);
  }

  const [workbook, application, metadata, dispatch] = await Promise.allSettled([
    refreshClassWorkbook(workerSecret),
    prepareNextCsfAutomaticApplicationSheet(),
    checkNextCsfAutomaticClassWorkbook(),
    dispatchCsfAutomaticClassPreviews(),
  ]);
  const workbookResponse =
    workbook.status === "fulfilled"
      ? workbook.value
      : json({ error: "Workbook preparation did not settle" }, 503);
  const applications =
    application.status === "fulfilled"
      ? applicationResultSchema.safeParse(application.value)
      : null;
  const checks =
    metadata.status === "fulfilled"
      ? metadataResultSchema.safeParse(metadata.value)
      : null;
  const dispatched =
    dispatch.status === "fulfilled"
      ? dispatchResultSchema.safeParse(dispatch.value)
      : null;
  const dispatchSummary = dispatched?.success
    ? dispatched.data
    : { checked: 0, queued: 0, needsAttention: 0, blocked: 0, unknown: 1 };
  const dispatchIdle = Object.values(dispatchSummary).every(
    (count) => count === 0,
  );
  if (
    applications?.success &&
    applications.data.status === "idle" &&
    checks?.success &&
    checks.data.status === "idle" &&
    dispatchIdle
  )
    return workbookResponse;
  const applicationSummary = applications?.success
    ? applications.data
    : { status: "unknown", claimed: 0, prepared: 0 };
  const metadataSummary = checks?.success
    ? checks.data
    : { status: "unknown", claimed: 0, queued: 0 };
  const unsettled =
    applicationSummary.status === "unknown" ||
    applicationSummary.status === "retryable" ||
    metadataSummary.status === "unknown" ||
    metadataSummary.status === "retryable" ||
    dispatchSummary.unknown > 0;
  return json(
    {
      ...(await workbookResponse.json()),
      ...(applicationSummary.status === "idle"
        ? {}
        : { applications: applicationSummary }),
      ...(metadataSummary.status === "idle"
        ? {}
        : { workbookChecks: metadataSummary }),
      ...(dispatchIdle ? {} : { automaticClassImports: dispatchSummary }),
    },
    unsettled ? 503 : workbookResponse.status,
  );
}

async function refreshClassWorkbook(workerSecret: string) {
  const plugin = createPluginAdminClient();
  const { data, error } = await plugin.rpc(
    "csf_claim_class_workbook_refresh_job",
    { p_lease_seconds: 300 },
  );
  if (error) return json({ error: "Workbook queue unavailable" }, 503);
  const claim = claimSchema.safeParse(data);
  if (!claim.success) {
    return json({ error: "Workbook queue returned invalid data" }, 503);
  }
  if (!claim.data.claimed) {
    return json({ enabled: true, claimed: 0, prepared: 0, blocked: 0 });
  }

  const workerContext: CsfClassWorkbookWorkerContext = {
    jobId: claim.data.jobId,
    leaseToken: claim.data.leaseToken,
    actorUserId: claim.data.ownerUserId,
    secret: workerSecret,
  };
  const formData = new FormData();
  formData.set("cohortId", claim.data.cohortId);
  formData.set("spreadsheet", claim.data.driveFileId);
  formData.set("expectedProviderVersion", claim.data.providerVersion);
  const result = await linkCsfClassSheetAction(
    claim.data.organizationId,
    formData,
    workerContext,
  );
  if (
    result.workerDisposition === "retryable" ||
    result.workerDisposition === "unknown"
  ) {
    return json({ error: "Workbook preparation did not settle" }, 503);
  }
  if (
    result.workerDisposition !== "completed" &&
    result.workerDisposition !== "needs_reconnect" &&
    result.workerDisposition !== "blocked"
  ) {
    return json({ error: "Workbook preparation returned invalid data" }, 503);
  }
  const status = result.workerDisposition;
  const preparedCount = result.preparedTermCodes?.length ?? 0;
  const templateCount = result.templateTermCodes?.length ?? 0;
  const blockedCount = result.success
    ? (result.missingTabTermCodes?.length ?? 0) +
      (result.blockedTermCodes?.length ?? 0)
    : 1;
  const { data: finishData, error: finishError } = await plugin.rpc(
    "csf_finish_class_workbook_refresh_job",
    {
      p_job_id: claim.data.jobId,
      p_lease_token: claim.data.leaseToken,
      p_status: status,
      p_discovered_tabs: result.discoveredTabs ?? [],
      p_prepared_count: preparedCount,
      p_template_count: templateCount,
      p_blocked_count: blockedCount,
      p_error_code:
        status === "completed"
          ? null
          : status === "needs_reconnect"
            ? "google_access_missing"
            : "workbook_preparation_blocked",
    },
  );
  if (finishError) {
    return json({ error: "Workbook result could not be settled" }, 503);
  }
  const finish = finishSchema.safeParse(finishData);
  if (!finish.success) {
    return json({ error: "Workbook result could not be settled" }, 503);
  }

  const settledStatus = finish.data.status;
  const settledBlockedCount =
    settledStatus === "completed" ? blockedCount : Math.max(blockedCount, 1);

  return json({
    enabled: true,
    claimed: 1,
    prepared: settledStatus === "completed" ? preparedCount : 0,
    templates: settledStatus === "completed" ? templateCount : 0,
    blocked: settledBlockedCount,
    status: settledStatus,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
