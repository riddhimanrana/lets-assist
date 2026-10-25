import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { z } from "zod";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
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
    .select(PROJECT_CLIENT_SELECT)
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
      <nav
        aria-label="Saved attendance batches"
        className="container mx-auto grid max-w-6xl items-start gap-4 px-4 pb-8 sm:grid-cols-2 sm:px-6"
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
          <Card key={cursor} className="gap-0 py-0">
            <details open={cursor === "draftsBefore" || list.hasCursor}>
              <summary className="flex items-center gap-2 px-4 py-3 text-sm font-medium">
                {title}
                {list.rows.length > 0 ? (
                  <Badge variant="secondary">{list.rows.length}</Badge>
                ) : null}
              </summary>
              <div className="border-t px-2 py-2">
                {list.rows.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-2 text-sm">
                    No {list.hasCursor ? "older " : ""}
                    {cursor === "draftsBefore"
                      ? "unfinished drafts"
                      : "saved history"}
                    .
                  </p>
                ) : (
                  <ul className="grid gap-0.5">
                    {list.rows.map((draft) => (
                      <li key={draft.id}>
                        <Link
                          className="hover:bg-muted focus-visible:ring-ring/50 aria-[current=page]:bg-muted flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm outline-none focus-visible:ring-[3px]"
                          aria-current={
                            draft.id === openBatch?.id ? "page" : undefined
                          }
                          href={batchHistoryHref(projectId, queryParams, {
                            batch: draft.id,
                          })}
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate font-medium">
                              {action}{" "}
                              {draft.input_method === "manual"
                                ? "manual attendance"
                                : "scanned sheets"}
                              :{" "}
                              {slotOptions.find((slot) =>
                                slot.aliases?.includes(draft.schedule_id),
                              )?.label ?? draft.schedule_id}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {new Date(draft.created_at).toLocaleString(
                                "en-US",
                                {
                                  timeZone:
                                    project.project_timezone ||
                                    "America/Los_Angeles",
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                },
                              )}
                            </span>
                          </span>
                          <Badge
                            variant={
                              draft.status === "failed"
                                ? "destructive"
                                : draft.status === "review"
                                  ? "warning"
                                  : draft.status === "extracting"
                                    ? "info"
                                    : draft.status === "draft"
                                      ? "outline"
                                      : "success"
                            }
                          >
                            {draft.status === "failed"
                              ? "Scan needs retry"
                              : draft.status === "extracting"
                                ? "Scan in progress"
                                : draft.status === "review"
                                  ? "Needs review"
                                  : draft.status === "draft"
                                    ? "Draft"
                                    : "Saved"}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {list.hasCursor || list.nextCursor ? (
                  <div className="flex gap-1 px-0 pt-1">
                    {list.hasCursor && (
                      <Link
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                        href={batchHistoryHref(projectId, queryParams, {
                          [cursor]: null,
                        })}
                      >
                        Newest{" "}
                        {cursor === "draftsBefore" ? "drafts" : "history"}
                      </Link>
                    )}
                    {list.nextCursor && (
                      <Link
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                        href={batchHistoryHref(projectId, queryParams, {
                          [cursor]: list.nextCursor,
                        })}
                      >
                        Older {cursor === "draftsBefore" ? "drafts" : "history"}
                      </Link>
                    )}
                  </div>
                ) : null}
              </div>
            </details>
          </Card>
        ))}
      </nav>
    </>
  );
}
