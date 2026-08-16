import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { runPaperSignupNotificationWorker } from "@/services/paper-signup-notification-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

function isAuthorized(request: NextRequest): boolean {
  const match = BEARER_GRAMMAR.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  const expected =
    process.env.PAPER_SIGNUP_NOTIFICATION_WORKER_SECRET_TOKEN ??
    process.env.CRON_TOKEN ??
    process.env.CRON_SECRET;
  if (!expected) return false;
  const suppliedBytes = Buffer.from(match[1], "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const probe = cronAuthShapeProbe("paper-signup-notifications", request);
  if (probe) return probe;

  if (process.env.PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED !== "true") {
    return NextResponse.json({ enabled: false });
  }

  try {
    const result = await runPaperSignupNotificationWorker();
    return NextResponse.json({ enabled: true, ...result });
  } catch {
    return NextResponse.json({ error: "Worker run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
