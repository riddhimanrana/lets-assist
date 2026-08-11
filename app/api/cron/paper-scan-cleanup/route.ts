import { NextRequest, NextResponse } from "next/server";

import { getAdminClient } from "@/lib/supabase/admin";
import { drainPaperScanStorageDeletionQueue } from "@/lib/projects/paper-signup/cleanup-storage";

/**
 * Paper-scan retention: purge_expired_paper_scan_batches enqueues each
 * photo into the transactional outbox and deletes the staging rows in one
 * transaction; this worker drains the outbox afterwards. Committed batches
 * purge 7 days after commit (the photos are raw PII with no further use
 * once the signups exist); drafts and failures at 30 days.
 */

function authorizeCronRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron secret not configured" },
        { status: 500 },
      ),
    };
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true } as const;
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = getAdminClient();

    // Always retry previously committed outbox work first, even when this
    // run purges nothing new.
    const initialDrain = await drainPaperScanStorageDeletionQueue(supabase);
    if (initialDrain.error) {
      console.error(
        "Error draining paper-scan deletion queue:",
        initialDrain.error,
      );
      return NextResponse.json({ error: initialDrain.error }, { status: 500 });
    }

    const { data: purgedCount, error: purgeError } = await supabase.rpc(
      "purge_expired_paper_scan_batches",
      { p_limit: 50 },
    );
    if (purgeError) {
      console.error("Error purging expired scan batches:", purgeError);
      return NextResponse.json(
        { error: "Failed to purge expired scan batches" },
        { status: 500 },
      );
    }

    const finalDrain = await drainPaperScanStorageDeletionQueue(supabase);
    if (finalDrain.error) {
      console.error(
        "Error deleting purged scan photos:",
        finalDrain.error,
      );
      return NextResponse.json({ error: finalDrain.error }, { status: 500 });
    }

    return NextResponse.json({
      purgedBatches: Number(purgedCount ?? 0),
      storageDeleted: initialDrain.deleted + finalDrain.deleted,
    });
  } catch (error) {
    console.error("Paper-scan cleanup cron failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
