import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { drainWaiverStorageDeletionQueue } from "@/lib/waiver/cleanup-storage";
import {
  getProjectRetentionFinishedAt,
  type RetentionProject,
} from "@/lib/retention/project-finished-at";

/**
 * Anonymous Cleanup Cron
 * Deletes anonymous profiles and their signups 30 days after the associated project's last event.
 */

const BATCH_SIZE = 100;
const PAGE_SIZE = 500;

function authorizeCronRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Cron secret not configured" }, { status: 500 }),
    };
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true } as const;
}

async function cleanupAnonymousProfiles() {
  const supabase = getAdminClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const initialDrain = await drainWaiverStorageDeletionQueue(supabase);
  if (initialDrain.error) {
    console.error("Error draining waiver Storage deletion queue:", initialDrain.error);
    return { error: initialDrain.error };
  }

  const idsToDelete: string[] = [];
  let offset = 0;

  while (idsToDelete.length < BATCH_SIZE) {
    const { data: candidates, error: candidatesError } = await supabase
      .from("anonymous_signups")
      .select(`
        id,
        created_at,
        projects!inner (
          status,
          cancelled_at,
          event_type,
          schedule,
          project_timezone
        )
      `)
      .or("status.eq.completed,status.eq.cancelled", { foreignTable: "projects" })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (candidatesError) {
      console.error("Error fetching candidates for anonymous cleanup:", candidatesError);
      return { error: "Failed to fetch candidates" };
    }

    for (const candidate of candidates ?? []) {
      const project = Array.isArray(candidate.projects)
        ? candidate.projects[0]
        : candidate.projects;
      const finishedAt = getProjectRetentionFinishedAt(project as RetentionProject);
      if (finishedAt && finishedAt.getTime() <= cutoffDate.getTime()) {
        idsToDelete.push(candidate.id);
        if (idsToDelete.length >= BATCH_SIZE) break;
      }
    }

    if (!candidates || candidates.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (idsToDelete.length === 0) {
    return { deleted: 0, storageDeleted: initialDrain.deleted };
  }

  const { data: archivedCount, error: archiveError } = await supabase.rpc(
    "archive_anonymous_signups_for_cleanup",
    { p_anonymous_ids: idsToDelete },
  );

  if (archiveError) {
    console.error("Error atomically archiving anonymous profiles:", archiveError);
    return { error: "Failed to archive anonymous profiles for cleanup" };
  }

  const finalDrain = await drainWaiverStorageDeletionQueue(supabase);
  if (finalDrain.error) {
    console.error("Error deleting archived anonymous waiver assets:", finalDrain.error);
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
    const result = await cleanupAnonymousProfiles();
    if ("error" in result) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Anonymous cleanup cron failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
