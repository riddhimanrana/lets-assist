import Link from "next/link";
import { z } from "zod";
import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getMultiDaySlotDisplayName, getProjectStatus } from "@/utils/project";
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

import { REVIEW_ROW_COLUMNS, paperRowView } from "./row-view";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; batch?: string }>;
}) {
  const { id: projectId } = await params;
  const queryParams = await searchParams;

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
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = activeOrganizationRole(membership);
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
  let batchQuery = supabase
    .from("project_paper_scan_batches")
    .select(
      "id, schedule_id, status, image_count, extracted_row_count, created_at, input_method",
    )
    .eq("project_id", projectId)
    .in(
      "status",
      queryParams.batch
        ? ["draft", "extracting", "review", "committed"]
        : ["draft", "extracting", "review"],
    )
    .order("created_at", { ascending: false })
    .limit(1);
  if (
    queryParams.batch &&
    z.string().uuid().safeParse(queryParams.batch).success
  )
    batchQuery = batchQuery.eq("id", queryParams.batch);
  const { data: batchRow } = await batchQuery.maybeSingle();
  const { data: savedDrafts } = await supabase
    .from("project_paper_scan_batches")
    .select("id,schedule_id,created_at,input_method")
    .eq("project_id", projectId)
    .in("status", ["draft", "extracting", "review", "committed"])
    .order("created_at", { ascending: false })
    .limit(30);

  let openBatch: PaperScanBatchView | null = null;
  let rows: PaperScanRowView[] = [];

  if (batchRow) {
    openBatch = {
      id: batchRow.id,
      scheduleId: batchRow.schedule_id,
      status:
        batchRow.status === "committed"
          ? "review"
          : (batchRow.status as PaperScanBatchView["status"]),
      imageCount: batchRow.image_count,
      inputMethod: batchRow.input_method,
    };

    if (["review", "committed"].includes(batchRow.status)) {
      const { data: rowData } = await supabase
        .from("project_paper_scan_rows")
        .select(REVIEW_ROW_COLUMNS)
        .eq("batch_id", batchRow.id)
        .order("sheet_row_number");

      rows = (rowData ?? []).map(paperRowView);
    }
  }

  const slotOptions = buildSlotOptions(project);
  const activeWindow = openBatch
    ? getAttendanceScheduleWindow(project, openBatch.scheduleId)
    : null;
  const projectStatus = getProjectStatus(project);
  const publishedState = (project.published ?? {}) as Record<string, boolean>;

  return (
    <>
      {savedDrafts && savedDrafts.length > 0 && (
        <nav
          aria-label="Saved attendance drafts"
          className="container mx-auto max-w-5xl px-4 pt-4"
        >
          <details>
            <summary>Resume a saved attendance draft</summary>
            <ul className="space-y-2 py-3">
              {savedDrafts.map((draft) => (
                <li key={draft.id}>
                  <Link
                    className="underline"
                    href={`/projects/${projectId}/paper-signups?batch=${draft.id}`}
                  >
                    {draft.input_method === "manual"
                      ? "Manual attendance"
                      : "Scanned sheets"}
                    : {draft.schedule_id},{" "}
                    {new Date(draft.created_at).toLocaleDateString("en-US", {
                      timeZone:
                        project.project_timezone || "America/Los_Angeles",
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </nav>
      )}
      <PaperSignupsClient
        key={openBatch?.id ?? "new"}
        initialMode={queryParams.mode === "manual" ? "manual" : "scan"}
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
    </>
  );
}
