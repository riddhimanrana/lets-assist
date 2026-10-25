"use client";

import { format, parseISO } from "date-fns";
import { CircleCheck, LogOut } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatTimeTo12Hour } from "@/lib/utils";

import type { SessionDetails } from "./attendance-session";

/**
 * The confirmation a volunteer shows an organizer: that they are in, when they
 * checked in, how much of the session is left, and how to leave.
 */
export function CheckedInView({
  projectId,
  projectTitle,
  sessionName,
  sessionDetails,
  checkInTime,
  checkedInAnonymously,
  displayEmail,
  progressPercentage,
  remainingTimeFormatted,
  isCheckingOut,
  onLeave,
  anonymousProfileHref,
}: {
  projectId: string;
  projectTitle: string;
  sessionName: string;
  sessionDetails: SessionDetails | null;
  checkInTime: Date | null;
  checkedInAnonymously: boolean;
  displayEmail: string;
  progressPercentage: number;
  remainingTimeFormatted: string;
  isCheckingOut: boolean;
  onLeave: () => void;
  anonymousProfileHref: string | null;
}) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 py-8 sm:px-6">
      <div className="grid gap-2" role="status">
        <CircleCheck className="text-success size-6" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Check-in successful
        </h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {checkedInAnonymously
            ? "Your attendance has been recorded anonymously."
            : "You're checked in to the event."}
        </p>
      </div>

      <div className="grid gap-4 border-y py-4">
        <div className="grid gap-0.5">
          <p className="text-muted-foreground text-sm">Check-in time</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {checkInTime ? format(checkInTime, "h:mm a") : "N/A"}
          </p>
        </div>

        {/* Progress runs from the check-in time to the end of the session. */}
        {sessionDetails?.endTime && checkInTime ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">Session duration</span>
              <span className="text-muted-foreground tabular-nums">
                {remainingTimeFormatted} remaining
              </span>
            </div>
            <Progress
              value={progressPercentage}
              aria-label={`Your progress: ${Math.round(progressPercentage)}%`}
            />
          </div>
        ) : null}
      </div>

      <dl className="grid gap-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="font-medium wrap-break-word">{projectTitle}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Session</dt>
          <dd className="font-medium wrap-break-word">{sessionName}</dd>
        </div>
        {sessionDetails?.date ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">
              {format(parseISO(sessionDetails.date), "EEEE, MMMM d, yyyy")}
            </dd>
          </div>
        ) : null}
        {sessionDetails?.startTime && sessionDetails?.endTime ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Time</dt>
            <dd className="font-medium tabular-nums">
              {formatTimeTo12Hour(sessionDetails.startTime)} -{" "}
              {formatTimeTo12Hour(sessionDetails.endTime)}
            </dd>
          </div>
        ) : null}
        {displayEmail ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium wrap-break-word">{displayEmail}</dd>
          </div>
        ) : null}
      </dl>

      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          When you finish volunteering, leave the event so your time is
          recorded.
        </p>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onLeave}
          disabled={isCheckingOut}
        >
          <LogOut data-icon="inline-start" aria-hidden="true" />
          {isCheckingOut ? "Leaving..." : "Leave event"}
        </Button>
        <div className="flex flex-wrap gap-x-6">
          <Link
            href={`/projects/${projectId}`}
            className={buttonVariants({ variant: "link", className: "px-0" })}
          >
            View project details
          </Link>
          {anonymousProfileHref ? (
            <Link
              href={anonymousProfileHref}
              className={buttonVariants({ variant: "link", className: "px-0" })}
            >
              Your anonymous profile
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
