import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { drainWaiverStorageDeletionQueue } from "@/lib/waiver/cleanup-storage";
import {
  getProjectRetentionFinishedAt,
  type RetentionProject,
} from "@/lib/retention/project-finished-at";

const BATCH_SIZE = 250;
const PAGE_SIZE = 500;

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

async function cleanupExpiredWaivers() {
  const supabase = getAdminClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  // Always retry previously committed outbox work, including when there are no
  // newly expired rows in this run.
  const initialDrain = await drainWaiverStorageDeletionQueue(supabase);
  if (initialDrain.error) {
    console.error(
      "Error draining waiver Storage deletion queue:",
      initialDrain.error,
    );
    return { error: initialDrain.error };
  }

  const eligibleSignatures: Array<{ id: string }> = [];
  let offset = 0;

  // Page deterministically until the batch is full or every candidate has
  // been inspected. A fixed first-page limit can permanently starve eligible
  // rows behind completed projects whose schedules have not actually ended.
  while (eligibleSignatures.length < BATCH_SIZE) {
    const { data: signatures, error } = await supabase
      .from("waiver_signatures")
      .select(
        `
        id,
        signed_at,
        projects!inner (
          status,
          cancelled_at,
          event_type,
          schedule,
          project_timezone
        )
      `,
      )
      .or("status.eq.completed,status.eq.cancelled", {
        foreignTable: "projects",
      })
      .order("signed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching expired waivers:", error);
      return { error: "Failed to load expired waivers" };
    }

    for (const signature of signatures ?? []) {
      const project = Array.isArray(signature.projects)
        ? signature.projects[0]
        : signature.projects;
      const finishedAt = getProjectRetentionFinishedAt(
        project as RetentionProject,
      );
      if (finishedAt && finishedAt.getTime() <= cutoffDate.getTime()) {
        eligibleSignatures.push({ id: signature.id });
        if (eligibleSignatures.length >= BATCH_SIZE) break;
      }
    }

    if (!signatures || signatures.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (eligibleSignatures.length === 0) {
    return { deleted: 0, storageDeleted: initialDrain.deleted };
  }

  const idsToDelete = eligibleSignatures.map((item) => item.id);
  const { data: archivedCount, error: archiveError } = await supabase.rpc(
    "archive_waiver_signatures_for_cleanup",
    { p_signature_ids: idsToDelete },
  );

  if (archiveError) {
    console.error("Error atomically archiving waiver records:", archiveError);
    return { error: "Failed to archive waiver records for cleanup" };
  }

  const finalDrain = await drainWaiverStorageDeletionQueue(supabase);
  if (finalDrain.error) {
    console.error("Error deleting archived waiver assets:", finalDrain.error);
    return { error: finalDrain.error };
  }

  return {
    deleted: Number(archivedCount ?? 0),
    storageDeleted: initialDrain.deleted + finalDrain.deleted,
  };
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await cleanupExpiredWaivers();
    if ("error" in result) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Waiver cleanup cron failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
