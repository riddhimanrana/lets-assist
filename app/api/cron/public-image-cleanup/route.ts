import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { runPublicImageCleanup } from "@/lib/storage/public-image-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const allowed = [process.env.CRON_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  const token = /^Bearer ([\x21-\x7e]+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !token ||
    !allowed.reduce(
      (matched, candidate) =>
        timingSafeEqual(digest(token), digest(candidate)) || matched,
      false,
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const probe = cronAuthShapeProbe("public-image-cleanup", request);
  if (probe) return probe;
  if (process.env.PUBLIC_IMAGE_CLEANUP_ENABLED !== "true")
    return NextResponse.json({ enabled: false });
  return observeWorkerRun("public-image-cleanup", async () => {
    try {
      const result = await runPublicImageCleanup();
      return NextResponse.json({ enabled: true, ...result });
    } catch {
      return NextResponse.json(
        { enabled: true, error: "Image cleanup could not be confirmed" },
        { status: 500 },
      );
    }
  });
}
export const GET = handle;
export const POST = handle;
