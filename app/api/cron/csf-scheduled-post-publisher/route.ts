import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

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

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const probe = cronAuthShapeProbe("csf-scheduled-post-publisher", request);
  if (probe) return probe;
  // Keep old callers harmless while their deployment is replaced.
  return NextResponse.json(
    {
      enabled: false,
      retired: true,
      examined: 0,
      published: 0,
      held: 0,
      organizationsChanged: 0,
      cacheRefreshFailures: 0,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
