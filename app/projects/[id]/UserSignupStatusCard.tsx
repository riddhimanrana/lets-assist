"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Camera, TicketCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, formatTimeTo12Hour } from "@/lib/utils";
import type { Project } from "@/types";
import {
  calculateVolunteerDuration,
  type SignupStatus,
} from "./user-dashboard-status";

type Tone = "info" | "success" | "warning" | "destructive";

const TONE_RING: Record<Tone, string> = {
  info: "ring-info/30",
  success: "ring-success/30",
  warning: "ring-warning/30",
  destructive: "ring-destructive/30",
};

interface Fact {
  label: string;
  value: ReactNode;
}

interface Note {
  title: string;
  body: string;
}

/** One signup's state: what it is, the facts, what happens next, one action. */
function StatusCard({
  tone,
  badge,
  title,
  description,
  facts,
  notes,
  children,
}: {
  tone: Tone;
  badge: string;
  title: string;
  description: string;
  facts: Fact[];
  notes?: Note[];
  children?: ReactNode;
}) {
  return (
    <Card className={TONE_RING[tone]}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={tone}>{badge}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-2 text-sm">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
            >
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-right font-medium wrap-break-word">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
        {notes && notes.length > 0 ? (
          <div className="grid gap-3 border-t pt-4">
            {notes.map((note) => (
              <div key={note.title} className="grid gap-0.5">
                <p className="text-sm font-medium">{note.title}</p>
                <p className="text-muted-foreground text-sm">{note.body}</p>
              </div>
            ))}
          </div>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

function attendanceFacts(status: SignupStatus): Fact[] {
  const facts: Fact[] = [
    { label: "Session", value: status.sessionDisplayName },
  ];
  const checkIn = "checkInTime" in status ? status.checkInTime : null;
  const checkOut = "checkOutTime" in status ? status.checkOutTime : null;

  if (checkIn) {
    facts.push({ label: "Check-in", value: format(checkIn, "MMM d, h:mm a") });
  }
  if (checkOut) {
    facts.push({
      label: "Check-out",
      value: format(checkOut, "MMM d, h:mm a"),
    });
  }
  if (checkIn && checkOut) {
    const duration = calculateVolunteerDuration(
      checkIn.toISOString(),
      checkOut.toISOString(),
    );
    facts.push({
      label: "Total hours",
      value: (
        <span className={cn(!duration.isValid && "text-destructive")}>
          {duration.text}
        </span>
      ),
    });
  }
  return facts;
}

/** Renders the card for one signup state, or nothing when it does not apply. */
export function UserSignupStatusCard({
  status,
  project,
  hideReminder,
  onScan,
}: {
  status: SignupStatus;
  project: Project;
  hideReminder: boolean;
  onScan: (scheduleId: string) => void;
}) {
  const sessionTime = `${formatTimeTo12Hour(status.slotDetails.startTime)} - ${formatTimeTo12Hour(status.slotDetails.endTime)}`;

  switch (status.renderState) {
    case "pendingLinked":
      return (
        <StatusCard
          tone="info"
          badge="Pending coordinator review"
          title="Signup pending approval"
          description={`Your signup for ${project.title} is awaiting project coordinator confirmation.`}
          facts={[{ label: "Session", value: status.sessionDisplayName }]}
          notes={[
            {
              title: "How it got here",
              body: "This signup was linked from your anonymous profile or created through an email notification. The project coordinator will review and approve it soon.",
            },
            {
              title: "What to expect",
              body: "Once approved, you'll be able to check in for the event and track your volunteer hours. You can check the status of your signup anytime.",
            },
            {
              title: "Questions?",
              body: "If you have any questions about your signup, you can reach out to the project coordinator directly.",
            },
          ]}
        />
      );

    case "hoursPublished":
      return (
        <StatusCard
          tone="success"
          badge="Published"
          title="Volunteer hours published!"
          description={`Your hours for ${project.title} have been finalized.`}
          facts={attendanceFacts(status)}
          notes={[
            {
              title: "View your record",
              body: "Your participation details and hours are now available in your volunteer dashboard",
            },
          ]}
        >
          <Button
            variant="outline"
            className="justify-self-start"
            render={
              <Link
                href={`/certificates/${"certificateId" in status ? status.certificateId : null}`}
              />
            }
          >
            <TicketCheck data-icon="inline-start" aria-hidden="true" />
            View certificate
          </Button>
        </StatusCard>
      );

    case "postEventHours":
      return (
        <StatusCard
          tone="warning"
          badge="Processing"
          title="Hours being processed"
          description={`Thank you for your participation in ${project.title}`}
          facts={[
            ...attendanceFacts(status),
            {
              label: "Processing time remaining",
              value: `${48 - (("hoursSinceEnd" in status && status.hoursSinceEnd) || 0)} hours`,
            },
          ]}
          notes={[
            {
              title: "Processing period",
              body: "The project owner is reviewing hours and all records will be finalized within 48 hours after the event.",
            },
            {
              title: "Need adjustments?",
              body: "If your recorded hours need correction, please contact the project owner directly.",
            },
          ]}
        />
      );

    case "missedEvent":
      return (
        <StatusCard
          tone="destructive"
          badge="Not attended"
          title="Event not attended"
          description={`You were signed up for ${project.title} but no attendance was recorded.`}
          facts={[{ label: "Session", value: status.sessionDisplayName }]}
          notes={[
            {
              title: "Think this is a mistake?",
              body: "If you believe this is an error, please contact the project organizer directly. Your signup status might be updated if there was a check-in issue.",
            },
          ]}
        />
      );

    case "checkedIn": {
      if (!("isCheckedIn" in status)) return null;
      const checkInDisplayTime = status.checkInTime
        ? format(status.checkInTime, "h:mm a")
        : "Confirmed";
      const checkOutDisplayTime = status.checkOutTime
        ? format(status.checkOutTime, "h:mm a")
        : null;
      // No progress once the session is over or the volunteer checked out.
      const showProgress = !status.isSessionOver && !status.checkOutTime;
      const facts: Fact[] = [
        { label: "Session", value: status.sessionDisplayName },
        {
          label: "Status",
          value:
            checkInDisplayTime === "Confirmed"
              ? "Attended"
              : `Checked in at ${checkInDisplayTime}`,
        },
      ];
      if (checkOutDisplayTime) {
        facts.push({
          label: "Check-out",
          value: `Checked out at ${checkOutDisplayTime}`,
        });
      }
      facts.push({ label: "Session time", value: sessionTime });

      return (
        <StatusCard
          tone="success"
          badge={status.checkOutTime ? "Completed" : "Checked in"}
          title={
            status.checkOutTime
              ? "Attendance completed"
              : "Attendance confirmed"
          }
          description={`Your attendance for ${project.title} is confirmed.`}
          facts={facts}
        >
          {showProgress ? (
            <div className="grid gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Session progress</span>
                <span className="font-medium tabular-nums">
                  {status.remainingTimeFormatted} remaining
                </span>
              </div>
              <Progress
                value={status.progressPercentage ?? 0}
                aria-label={`Session progress: ${Math.round(status.progressPercentage ?? 0)}%`}
              />
            </div>
          ) : null}
          {!showProgress && !status.areHoursPublished ? (
            <p className="text-muted-foreground text-sm">
              Session concluded. Awaiting final hours processing.
            </p>
          ) : null}
        </StatusCard>
      );
    }

    case "checkInOpen": {
      // No check-in card for cancelled or sign-up only projects.
      if (
        project.status === "cancelled" ||
        project.verification_method === "signup-only"
      ) {
        return null;
      }

      const startsAt = formatTimeTo12Hour(status.slotDetails.startTime);
      const lead = `Check-in for your session ${status.sessionDisplayName} starting at ${startsAt}`;
      let title = "Check-in is open!";
      let badge = "Check-in open";
      let info = `${lead} is now available.`;
      let action: ReactNode = null;

      switch (project.verification_method) {
        case "qr-code":
          info = `${lead} is now available. Scan the QR code provided by the organizer to check in.`;
          action = (
            <Button
              className="justify-self-start"
              aria-label={`Open camera to scan QR code for session ${status.sessionDisplayName}`}
              onClick={() => onScan(status.signup.schedule_id)}
            >
              <Camera data-icon="inline-start" aria-hidden="true" />
              Scan QR code
            </Button>
          );
          break;
        case "manual":
          title = "Check-in required";
          badge = "In person";
          info = `${lead} needs to be done in person. Please find the project organizer when you arrive at the venue.`;
          break;
        case "auto":
          title = "Upcoming session";
          badge = "Automatic";
          info = `${lead} will happen automatically at the start time. No action is required from you.`;
          break;
      }

      return (
        <StatusCard
          tone="info"
          badge={badge}
          title={title}
          description={`Check-in available for ${project.title}`}
          facts={[
            { label: "Session", value: status.sessionDisplayName },
            { label: "Starts at", value: startsAt },
          ]}
        >
          <p className="text-muted-foreground text-sm">{info}</p>
          {action}
        </StatusCard>
      );
    }

    case "reminder":
      // The general "starting soon" notice already covers sign-up only events.
      if (hideReminder || !("timeUntilStartFormatted" in status)) return null;
      return (
        <StatusCard
          tone="info"
          badge="Upcoming"
          title="Upcoming session"
          description={`Your scheduled session for ${project.title} is approaching.`}
          facts={[
            { label: "Session", value: status.sessionDisplayName },
            { label: "Starts in", value: status.timeUntilStartFormatted },
            { label: "Session time", value: sessionTime },
          ]}
        >
          <p className="text-muted-foreground text-sm">
            {project.verification_method === "auto"
              ? "Check-in will happen automatically at the start time. No action needed."
              : "Check-in will be available 2 hours before start time."}
          </p>
        </StatusCard>
      );

    default:
      return null;
  }
}

/** Whether a status produces a card at all, so empty carousels never render. */
export function signupStatusHasCard(
  status: SignupStatus,
  project: Project,
  hideReminder: boolean,
) {
  if (status.renderState === "checkInOpen") {
    return (
      project.status !== "cancelled" &&
      project.verification_method !== "signup-only"
    );
  }
  if (status.renderState === "reminder") return !hideReminder;
  return true;
}
