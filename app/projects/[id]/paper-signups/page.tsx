import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { canManageProjectAccess } from "@/lib/projects/management-access";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import {
  getMultiDaySlotDisplayName,
  getProjectStatus,
} from "@/utils/project";
import type { Project } from "@/types";

import {
  PaperSignupsClient,
  type PaperScanBatchView,
  type PaperScanRowView,
  type PaperScanSlotOption,
} from "./PaperSignupsClient";

export const metadata: Metadata = {
  title: "Scan paper signups",
};

type RawExtractionField = { value: string | null; confidence: number };
type RawExtraction = {
  name?: RawExtractionField;
  email?: RawExtractionField;
  phone?: RawExtractionField;
  timeIn?: RawExtractionField;
  timeOut?: RawExtractionField;
};

function fieldConfidence(field: RawExtractionField | undefined): number {
  return typeof field?.confidence === "number" ? field.confidence : 0;
}

function buildSlotOptions(project: Project): PaperScanSlotOption[] {
  const options: Array<{ id: string; label: string }> = [];

  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    options.push({ id: "oneTime", label: "Main session" });
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        options.push({
          id: `${day.date}-${dayIndex}-${slotIndex}`,
          label: `${day.date} · ${getMultiDaySlotDisplayName(slot, slotIndex)}`,
        });
      });
    });
  } else if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    project.schedule.sameDayMultiArea.roles.forEach((role) => {
      options.push({ id: role.name, label: role.name });
    });
  }

  return options.flatMap((option) => {
    const window = getAttendanceScheduleWindow(project, option.id);
    if (!window) return [];
    return [
      {
        id: option.id,
        label: option.label,
        windowStartsAt: window.startsAt,
        windowEndsAt: window.endsAt,
      },
    ];
  });
}

export default async function PaperSignupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    redirect(`/login?redirect=/projects/${projectId}/paper-signups`);
  }

  const supabase = await createClient();
  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!projectData) notFound();
  const project = projectData as Project & {
    organization_id: string | null;
    can_be_managed_by_staff: boolean | null;
  };

  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = membership?.role ?? null;
  }
  if (
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff ?? false,
    })
  ) {
    notFound();
  }

  // The organizer's SELECT policies cover these reads; no admin client needed.
  const { data: batchRow } = await supabase
    .from("project_paper_scan_batches")
    .select(
      "id, schedule_id, status, image_count, extracted_row_count, created_at",
    )
    .eq("project_id", projectId)
    .in("status", ["draft", "extracting", "review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let openBatch: PaperScanBatchView | null = null;
  let rows: PaperScanRowView[] = [];

  if (batchRow) {
    openBatch = {
      id: batchRow.id,
      scheduleId: batchRow.schedule_id,
      status: batchRow.status as PaperScanBatchView["status"],
      imageCount: batchRow.image_count,
    };

    if (batchRow.status === "review") {
      const { data: rowData } = await supabase
        .from("project_paper_scan_rows")
        .select(
          "id, sheet_row_number, image_id, raw_extraction, overall_confidence, name, email, phone, check_in_time, check_out_time, signature_present, match_kind, match_signup_id, match_score, match_reasons, decision, outcome, outcome_detail",
        )
        .eq("batch_id", batchRow.id)
        .order("sheet_row_number");

      rows = (rowData ?? []).map((row) => {
        const raw = (row.raw_extraction ?? {}) as RawExtraction;
        return {
          id: row.id,
          sheetRowNumber: row.sheet_row_number,
          imageId: row.image_id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          checkInTime: row.check_in_time,
          checkOutTime: row.check_out_time,
          signaturePresent: row.signature_present,
          overallConfidence: Number(row.overall_confidence ?? 0),
          fieldConfidence: {
            name: fieldConfidence(raw.name),
            email: fieldConfidence(raw.email),
            phone: fieldConfidence(raw.phone),
            timeIn: fieldConfidence(raw.timeIn),
            timeOut: fieldConfidence(raw.timeOut),
          },
          matchKind: row.match_kind,
          matchSignupId: row.match_signup_id,
          matchScore: row.match_score === null ? null : Number(row.match_score),
          matchReasons: row.match_reasons ?? [],
          decision: row.decision as PaperScanRowView["decision"],
          outcome: row.outcome,
          outcomeDetail: row.outcome_detail,
        };
      });
    }
  }

  const slotOptions = buildSlotOptions(project);
  const activeWindow = openBatch
    ? getAttendanceScheduleWindow(project, openBatch.scheduleId)
    : null;
  const projectStatus = getProjectStatus(project);
  const publishedState = (project.published ?? {}) as Record<string, boolean>;

  return (
    <PaperSignupsClient
      projectId={projectId}
      projectTitle={project.title}
      projectTimezone={project.project_timezone || "America/Los_Angeles"}
      projectStatus={projectStatus}
      publishedState={publishedState}
      slotOptions={slotOptions}
      initialBatch={openBatch}
      initialRows={rows}
      activeWindow={
        activeWindow
          ? { startsAt: activeWindow.startsAt, endsAt: activeWindow.endsAt }
          : null
      }
    />
  );
}
