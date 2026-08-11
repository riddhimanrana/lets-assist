import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import {
  FEEDBACK_WORKER_MAX_BATCH_SIZE,
  runProjectFeedbackWorker,
} from "@/services/project-feedback-worker";
import { readPositiveInteger } from "@/lib/async/map-with-concurrency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_DEADLINE_MS = 45_000;

/**
 * Hardened cron auth (copied from csf-communications-dispatch): one anchored
 * grammar so the token cannot carry padding, whitespace, or control bytes,
 * timing-safe comparison, env re-read per request, and deny-when-unconfigured.
 */
const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

function extractBearerSecret(header: string | null): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER_GRAMMAR.exec(header);
  return match ? match[1] : null;
}

function secretsMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(request: NextRequest): boolean {
  const presented = extractBearerSecret(request.headers.get("authorization"));
  if (presented === null) return false;

  // Read at request time so a rotated secret takes effect immediately.
  const allowedTokens = [
    process.env.PROJECT_FEEDBACK_WORKER_SECRET_TOKEN,
    process.env.CRON_TOKEN ?? process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));

  // No secret configured means no access, never fail-open.
  if (allowedTokens.length === 0) return false;

  // reduce, not some: comparison count must not depend on which matched.
  return allowedTokens.reduce(
    (matched, candidate) => secretsMatch(candidate, presented) || matched,
    false,
  );
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Strictly after auth, before any Supabase client, query, or provider call.
  const probe = cronAuthShapeProbe("project-feedback-followups", request);
  if (probe) return probe;

  if (process.env.PROJECT_FEEDBACK_WORKER_ENABLED !== "true") {
    return NextResponse.json({
      enabled: false,
      message:
        "Set PROJECT_FEEDBACK_WORKER_ENABLED=true to process feedback follow-ups.",
    });
  }

  const batchSize = readPositiveInteger(
    process.env.PROJECT_FEEDBACK_WORKER_BATCH_SIZE,
    25,
    FEEDBACK_WORKER_MAX_BATCH_SIZE,
  );

  try {
    const startedAt = Date.now();
    const result = await runProjectFeedbackWorker({
      batchSize,
      deadlineMs: RUN_DEADLINE_MS,
    });

    // Aggregates only: no request ids, no addresses, no provider error text.
    return NextResponse.json({
      enabled: true,
      ...result,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("Project feedback follow-up worker failed:", error);
    return NextResponse.json({ error: "Worker run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
