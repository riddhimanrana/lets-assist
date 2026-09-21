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
import {
  getPublishStateKey,
  getScheduleIdAliases,
} from "@/lib/projects/hours-publish-key";
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
import {
  batchHistoryHref,
  loadBatchHistoryPage,
  UNRESOLVED_BATCH_STATUSES,
  type BatchHistoryParams,
} from "./batch-history";

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
        aliases: getScheduleIdAliases(project, option.id),
        publishKey: getPublishStateKey(project, option.id),
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
  searchParams: Promise<
    Partial<Record<keyof BatchHistoryParams, string | string[]>>
  >;
}) {
  const { id: projectId } = await params;
  const rawParams = await searchParams;
  const queryParams: BatchHistoryParams = {};
  for (const key of [
    "mode",
    "batch",
    "draftsBefore",
    "historyBefore",
  ] as const) {
    if (typeof rawParams[key] === "string") queryParams[key] = rawParams[key];
  }

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
        ? ["draft", "extracting", "review", "failed", "committed"]
        : UNRESOLVED_BATCH_STATUSES,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (
    queryParams.batch &&
    z.string().uuid().safeParse(queryParams.batch).success
  )
    batchQuery = batchQuery.eq("id", queryParams.batch);
  const { data: batchRow } = await batchQuery.maybeSingle();
  const [drafts, history] = await Promise.all([
    loadBatchHistoryPage(
      supabase,
      projectId,
      "drafts",
      queryParams.draftsBefore,
    ),
    loadBatchHistoryPage(
      supabase,
      projectId,
      "history",
      queryParams.historyBefore,
    ),
  ]);

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
      <nav
        aria-label="Saved attendance batches"
        className="container mx-auto max-w-5xl space-y-4 px-4 pt-4"
      >
        {(
          [
            {
              title: "Unfinished attendance drafts",
              list: drafts,
              cursor: "draftsBefore",
              action: "Resume",
            },
            {
              title: "Saved attendance history",
              list: history,
              cursor: "historyBefore",
              action: "Open",
            },
          ] as const
        ).map(({ title, list, cursor, action }) => (
          <details
            key={cursor}
            open={cursor === "draftsBefore" || list.hasCursor}
          >
            <summary>{title}</summary>
            {list.rows.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                No {list.hasCursor ? "older " : ""}
                {cursor === "draftsBefore"
                  ? "unfinished drafts"
                  : "saved history"}
                .
              </p>
            ) : (
              <ul className="space-y-2 py-3">
                {list.rows.map((draft) => (
                  <li key={draft.id}>
                    <Link
                      className="underline"
                      aria-current={
                        draft.id === openBatch?.id ? "page" : undefined
                      }
                      href={batchHistoryHref(projectId, queryParams, {
                        batch: draft.id,
                      })}
                    >
                      {action}{" "}
                      {draft.input_method === "manual"
                        ? "manual attendance"
                        : "scanned sheets"}
                      :{" "}
                      {slotOptions.find((slot) =>
                        slot.aliases?.includes(draft.schedule_id),
                      )?.label ?? draft.schedule_id}
                      ,{" "}
                      {new Date(draft.created_at).toLocaleString("en-US", {
                        timeZone:
                          project.project_timezone || "America/Los_Angeles",
                      })}{" "}
                      (
                      {draft.status === "failed"
                        ? "Scan needs retry"
                        : draft.status === "extracting"
                          ? "Scan in progress"
                          : draft.status === "review"
                            ? "Needs review"
                            : draft.status === "draft"
                              ? "Draft"
                              : "Saved"}
                      )
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-4 text-sm">
              {list.hasCursor && (
                <Link
                  className="underline"
                  href={batchHistoryHref(projectId, queryParams, {
                    [cursor]: null,
                  })}
                >
                  Newest {cursor === "draftsBefore" ? "drafts" : "history"}
                </Link>
              )}
              {list.nextCursor && (
                <Link
                  className="underline"
                  href={batchHistoryHref(projectId, queryParams, {
                    [cursor]: list.nextCursor,
                  })}
                >
                  Older {cursor === "draftsBefore" ? "drafts" : "history"}
                </Link>
              )}
            </div>
          </details>
        ))}
      </nav>
      <PaperSignupsClient
        key={
          typeof queryParams.batch === "string" ? queryParams.batch : "current"
        }
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
