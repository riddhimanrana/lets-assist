"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  differenceInHours,
  differenceInSeconds,
  format,
  isAfter,
  parseISO,
} from "date-fns";

import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Project } from "@/types";

import {
  formatScheduleSlot,
  getSlotTiming,
  type SlotData,
} from "./signup-schedule";

export type WaiverSignatureMeta = {
  signature_type: string;
  signed_at?: string | null;
};

function SignupStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return <Badge variant="success">Approved</Badge>;
    case "attended":
      return <Badge variant="success">Attended</Badge>;
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return (
        <Badge variant="secondary" className="capitalize">
          {status}
        </Badge>
      );
  }
}

/** One line of the signup receipt: the slot, its status, and what follows from it. */
export function SlotRow({
  slot,
  project,
  isProjectCancelled,
  isConfirmed,
  waiverSignature,
  certificateId,
  onCancel,
  onViewWaiver,
}: {
  slot: SlotData;
  project: Project;
  isProjectCancelled: boolean;
  isConfirmed: boolean;
  waiverSignature: WaiverSignatureMeta | null | undefined;
  certificateId?: string;
  onCancel: () => void;
  onViewWaiver: () => void | Promise<void>;
}) {
  const [waiverLoading, setWaiverLoading] = useState(false);
  const { sessionDate, endTime } = getSlotTiming(project, slot.schedule_id);

  const areHoursPublished = useMemo(() => {
    return project.published && project.published[slot.schedule_id] === true;
  }, [project.published, slot.schedule_id]);

  const isProjectOver = useMemo(() => {
    if (!sessionDate || !endTime) return false;
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      return !isNaN(endDt.getTime()) && isAfter(new Date(), endDt);
    } catch {
      return false;
    }
  }, [sessionDate, endTime]);

  const isInPostEventWindow = useMemo(() => {
    if (!endTime || !sessionDate) return false;
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (isNaN(endDt.getTime())) return false;
      const hoursSinceEnd = differenceInHours(new Date(), endDt);
      return (
        isAfter(new Date(), endDt) && hoursSinceEnd >= 0 && hoursSinceEnd < 48
      );
    } catch {
      return false;
    }
  }, [sessionDate, endTime]);

  const isMissedEvent =
    slot.status === "approved" &&
    !slot.check_in_time &&
    isProjectOver &&
    !areHoursPublished;

  // Progress calculation for attended slots
  let percent = 0;
  let checkInTimeFormatted = "";
  if (slot.status === "attended" && slot.check_in_time) {
    try {
      const checkIn = new Date(slot.check_in_time);
      checkInTimeFormatted = format(checkIn, "h:mm a");
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (!isNaN(endDt.getTime()) && !isNaN(checkIn.getTime())) {
        const totalSec = Math.max(1, differenceInSeconds(endDt, checkIn));
        const elapsedSec = Math.min(
          totalSec,
          differenceInSeconds(new Date(), checkIn),
        );
        percent = Math.round((elapsedSec / totalSec) * 100);
      }
    } catch {
      /* ignore */
    }
  }

  const canCancel =
    (isConfirmed || slot.status === "pending") &&
    slot.status !== "rejected" &&
    !isProjectCancelled &&
    !isProjectOver;

  const showProcessing =
    slot.status === "attended" && isInPostEventWindow && !areHoursPublished;
  const showProgress =
    slot.status === "attended" && slot.check_in_time && !areHoursPublished;
  const showWaiver = project.waiver_required && waiverSignature;

  return (
    <li className="grid gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium wrap-break-word">
            {formatScheduleSlot(project, slot.schedule_id)}
          </span>
          {project.project_timezone && (
            <TimezoneBadge timezone={project.project_timezone} />
          )}
        </div>
        <SignupStatusBadge status={slot.status} />
      </div>

      {areHoursPublished && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-success text-sm font-medium">Hours published</p>
          {certificateId && (
            <Link
              href={`/certificates/${certificateId}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Certificate
            </Link>
          )}
        </div>
      )}

      {showProcessing && (
        <p className="text-warning text-sm">
          Hours being processed (
          {48 -
            differenceInHours(
              new Date(),
              parseISO(`${sessionDate}T${endTime}`),
            )}{" "}
          hours remaining)
        </p>
      )}

      {isMissedEvent && (
        <p className="text-destructive text-sm">
          No attendance recorded. Contact the organizer if this is an error.
        </p>
      )}

      {showProgress && (
        <div className="grid gap-2">
          <div className="text-muted-foreground flex justify-between text-sm tabular-nums">
            <span>Checked in at {checkInTimeFormatted}</span>
            <span>{percent}%</span>
          </div>
          <Progress
            value={percent}
            aria-label={`Session progress: ${percent}%`}
          />
        </div>
      )}

      {(showWaiver || canCancel) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {showWaiver ? (
            <div className="text-muted-foreground flex items-center gap-1 text-sm">
              <span>
                Waiver signed{" "}
                {waiverSignature.signed_at
                  ? format(new Date(waiverSignature.signed_at), "MMM d, yyyy")
                  : ""}
              </span>
              <Button
                variant="link"
                className="px-1"
                onClick={async () => {
                  setWaiverLoading(true);
                  await onViewWaiver();
                  setWaiverLoading(false);
                }}
                disabled={waiverLoading}
              >
                {waiverLoading ? (
                  <Spinner aria-label="Loading waiver" />
                ) : (
                  "View"
                )}
              </Button>
            </div>
          ) : (
            <span />
          )}
          {canCancel && (
            <Button
              variant="destructive-ghost"
              className="-mr-2.5"
              onClick={onCancel}
            >
              Cancel this slot
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
