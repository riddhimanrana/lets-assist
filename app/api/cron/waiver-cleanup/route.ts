import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 250;
const SIGNATURE_BUCKET = "waiver-signatures";
const UPLOAD_BUCKET = "waiver-uploads";

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

async function cleanupExpiredWaivers() {
  const supabase = getAdminClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  // Fetch a wider candidate window and apply precise finish-time filtering in code.
  const { data: signatures, error } = await supabase
    .from("waiver_signatures")
    .select(`
      id,
      signature_storage_path,
      upload_storage_path,
      projects!inner (
        status,
        cancelled_at,
        event_type,
        schedule
      )
    `)
    .or("status.eq.completed,status.eq.cancelled", { foreignTable: "projects" })
    .limit(BATCH_SIZE * 5);

  if (error) {
    console.error("Error fetching expired waivers:", error);
    return { error: "Failed to load expired waivers" };
  }

  if (!signatures || signatures.length === 0) {
    return { deleted: 0 };
  }

  const eligibleSignatures = signatures
    .filter((signature) => {
      const project = Array.isArray(signature.projects)
        ? signature.projects[0]
        : signature.projects;
      const finishedAt = getProjectFinishedAt(project as CleanupProject);
      return !!finishedAt && finishedAt.getTime() <= cutoffDate.getTime();
    })
    .slice(0, BATCH_SIZE);

  if (eligibleSignatures.length === 0) {
    return { deleted: 0 };
  }

  const signaturePaths = eligibleSignatures
    .map((item) => item.signature_storage_path)
    .filter((path): path is string => Boolean(path));

  const uploadPaths = eligibleSignatures
    .map((item) => item.upload_storage_path)
    .filter((path): path is string => Boolean(path));

  if (signaturePaths.length > 0) {
    const { error: signatureDeleteError } = await supabase.storage
      .from(SIGNATURE_BUCKET)
      .remove(signaturePaths);

    if (signatureDeleteError) {
      console.error("Error deleting waiver signatures from storage:", signatureDeleteError);
    }
  }

  if (uploadPaths.length > 0) {
    const { error: uploadDeleteError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .remove(uploadPaths);

    if (uploadDeleteError) {
      console.error("Error deleting waiver uploads from storage:", uploadDeleteError);
    }
  }

  const idsToDelete = eligibleSignatures.map((item) => item.id);
  const { error: deleteError } = await supabase
    .from("waiver_signatures")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) {
    console.error("Error deleting waiver records:", deleteError);
    return { error: "Failed to delete waiver records" };
  }

  return { deleted: idsToDelete.length };
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
