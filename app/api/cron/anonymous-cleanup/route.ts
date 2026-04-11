import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Anonymous Cleanup Cron
 * Deletes anonymous profiles and their signups 30 days after the associated project's last event.
 */

const BATCH_SIZE = 100;

type CleanupProject = {
  status?: string | null;
  cancelled_at?: string | null;
  event_type?: string | null;
  schedule?: Record<string, unknown> | null;
};

function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateAndTime(dateValue?: string, timeValue?: string): Date | null {
  if (!dateValue || !timeValue) return null;

  const [hoursRaw, minutesRaw] = timeValue.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const date = toValidDate(`${dateValue}T00:00:00`);
  if (!date) return null;

  date.setHours(hours, minutes, 0, 0);
  return date;
}

function pickLatestDate(dates: Array<Date | null>): Date | null {
  const validDates = dates.filter((value): value is Date => value instanceof Date);
  if (validDates.length === 0) return null;

  return validDates.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest
  );
}

function getProjectFinishedAt(project: CleanupProject): Date | null {
  if (project.status === "cancelled") {
    return toValidDate(project.cancelled_at);
  }

  const schedule = project.schedule as Record<string, unknown> | null | undefined;
  if (!schedule || project.status !== "completed") return null;

  if (project.event_type === "oneTime") {
    const oneTime = schedule.oneTime as { date?: string; endTime?: string } | undefined;
    return parseDateAndTime(oneTime?.date, oneTime?.endTime);
  }

  if (project.event_type === "sameDayMultiArea") {
    const sameDay = schedule.sameDayMultiArea as
      | { date?: string; roles?: Array<{ endTime?: string }> }
      | undefined;
    const date = sameDay?.date;
    const latestEnd = pickLatestDate(
      (sameDay?.roles ?? []).map((role) => parseDateAndTime(date, role.endTime))
    );
    return latestEnd;
  }

  if (project.event_type === "multiDay") {
    const multiDay = schedule.multiDay as
      | Array<{ date?: string; slots?: Array<{ endTime?: string }> }>
      | undefined;

    const allSlotDates = (multiDay ?? []).flatMap((day) =>
      (day.slots ?? []).map((slot) => parseDateAndTime(day.date, slot.endTime))
    );
    return pickLatestDate(allSlotDates);
  }

  return null;
}

function authorizeCronRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_TOKEN;

  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 }),
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

  // Fetch a wider candidate window and then apply precise finish-time filtering in code.
  const { data: candidates, error: candidatesError } = await supabase
    .from("anonymous_signups")
    .select(`
      id,
      projects!inner (
        status,
        cancelled_at,
        event_type,
        schedule
      )
    `)
    .or("status.eq.completed,status.eq.cancelled", { foreignTable: "projects" })
    .limit(BATCH_SIZE * 5);

  if (candidatesError) {
    console.error("Error fetching candidates for anonymous cleanup:", candidatesError);
    return { error: "Failed to fetch candidates" };
  }

  if (!candidates || candidates.length === 0) {
    return { deleted: 0 };
  }

  const idsToDelete = candidates
    .filter((candidate) => {
      const project = Array.isArray(candidate.projects)
        ? candidate.projects[0]
        : candidate.projects;
      const finishedAt = getProjectFinishedAt(project as CleanupProject);
      return !!finishedAt && finishedAt.getTime() <= cutoffDate.getTime();
    })
    .slice(0, BATCH_SIZE)
    .map((candidate) => candidate.id);

  if (idsToDelete.length === 0) {
    return { deleted: 0 };
  }

  // 2. Delete the profiles (cascading deletes for project_signups and waiver_signatures 
  // handle the rest if foreign keys are set up with ON DELETE CASCADE)
  const { error: deleteError } = await supabase
    .from("anonymous_signups")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) {
    console.error("Error deleting anonymous profiles:", deleteError);
    return { error: "Failed to delete profiles" };
  }

  return { deleted: idsToDelete.length };
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
