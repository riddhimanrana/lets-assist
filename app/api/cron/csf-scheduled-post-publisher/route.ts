import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readPositiveInteger } from "@/lib/async/map-with-concurrency";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { revalidateFeed } from "@/lib/plugins/private/plugins/dvhs-csf/server/actions/support-feed-revalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_SIZE = 25;
const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

const holdsSchema = z.object({
  pluginUnavailable: z.number().int().min(0).max(MAX_BATCH_SIZE),
  actorUnavailable: z.number().int().min(0).max(MAX_BATCH_SIZE),
  termUnavailable: z.number().int().min(0).max(MAX_BATCH_SIZE),
  cohortUnavailable: z.number().int().min(0).max(MAX_BATCH_SIZE),
  expired: z.number().int().min(0).max(MAX_BATCH_SIZE),
  scheduledEmailUnsupported: z.number().int().min(0).max(MAX_BATCH_SIZE),
});

const publisherReportSchema = z
  .object({
    examined: z.number().int().min(0).max(MAX_BATCH_SIZE),
    published: z.number().int().min(0).max(MAX_BATCH_SIZE),
    held: z.number().int().min(0).max(MAX_BATCH_SIZE),
    holds: holdsSchema,
    organizationIds: z.array(z.string().uuid()).max(MAX_BATCH_SIZE),
  })
  .superRefine((value, context) => {
    if (value.examined !== value.published + value.held) {
      context.addIssue({
        code: "custom",
        message: "publisher counts do not balance",
      });
    }
    const holdTotal = Object.values(value.holds).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (holdTotal !== value.held) {
      context.addIssue({
        code: "custom",
        message: "publisher hold counts do not balance",
      });
    }
    if (new Set(value.organizationIds).size !== value.organizationIds.length) {
      context.addIssue({
        code: "custom",
        message: "publisher organization ids are not unique",
      });
    }
    if (value.organizationIds.length > value.examined) {
      context.addIssue({
        code: "custom",
        message: "publisher changed more organizations than posts",
      });
    }
  });

function secretsMatch(expected: string, presented: string): boolean {
  // Compare fixed-width digests so a rejected request does not disclose the
  // configured token length through an early length-mismatch branch.
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const presentedDigest = createHash("sha256")
    .update(presented, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  const match = typeof header === "string" ? BEARER_GRAMMAR.exec(header) : null;
  if (!match) return false;

  // Re-read on every request so a rotated token is not hidden by module cache.
  const allowed = [
    process.env.CSF_SCHEDULED_POST_PUBLISHER_SECRET_TOKEN,
    process.env.CRON_TOKEN ?? process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));
  if (allowed.length === 0) return false;

  // Do every same-length comparison; do not reveal which configured token won.
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
  if (!isAuthorized(request)) {
    // No client, query, cache mutation, provider, or other work occurs here.
    return json({ error: "Unauthorized" }, 401);
  }

  const probe = cronAuthShapeProbe("csf-scheduled-post-publisher", request);
  if (probe) return probe;

  // Exact opt-in. Absence, empty, "1", or any other value stays disabled.
  if (process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED !== "true") {
    return json({
      enabled: false,
      examined: 0,
      published: 0,
      held: 0,
      organizationsChanged: 0,
      cacheRefreshFailures: 0,
    });
  }

  const batchSize = readPositiveInteger(
    process.env.CSF_SCHEDULED_POST_PUBLISHER_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const workerId = `csf-scheduled-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

  let rawReport: unknown;
  try {
    const { data, error } = await createPluginAdminClient().rpc(
      "csf_publish_due_posts",
      {
        p_limit: batchSize,
        p_worker_id: workerId,
      },
    );
    if (error) throw new Error("scheduled_post_publisher_rpc_failed");
    rawReport = data;
  } catch {
    return json({ error: "Scheduled post publisher unavailable" }, 503);
  }

  const parsed = publisherReportSchema.safeParse(rawReport);
  if (!parsed.success) {
    return json(
      { error: "Scheduled post publisher returned invalid data" },
      503,
    );
  }

  let cacheRefreshFailures = 0;
  for (const organizationId of parsed.data.organizationIds) {
    try {
      revalidateFeed(organizationId);
    } catch {
      // Publication and its audit are already durable. A cache fault is a
      // separate aggregate outcome and must never invite a second publish.
      cacheRefreshFailures += 1;
    }
  }

  // Aggregate operational truth only. Organization and post identifiers stay
  // server-internal solely for targeted cache revalidation.
  return json({
    enabled: true,
    examined: parsed.data.examined,
    published: parsed.data.published,
    held: parsed.data.held,
    holds: parsed.data.holds,
    organizationsChanged: parsed.data.organizationIds.length,
    cacheRefreshFailures,
    batchSize,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
