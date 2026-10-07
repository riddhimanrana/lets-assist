"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Hourglass,
  Info,
  Pause,
  Printer,
  QrCode,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";

import type { Project } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CreatorDashboardPhase {
  isCancelled: boolean;
  isStartingSoon: boolean;
  isInProgress: boolean;
  isCompleted: boolean;
  isCheckInOpen: boolean;
}

function NoticeActions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap gap-2">{children}</div>;
}

function NoticeLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      className="no-underline!"
      render={<Link href={href} />}
    >
      {icon}
      {children}
    </Button>
  );
}

/** Links to the hours tool, or explains why it is closed. */
function ManageHoursAction({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  if (enabled) {
    return (
      <NoticeLink
        href={`/projects/${projectId}/hours`}
        icon={<Clock data-icon="inline-start" aria-hidden="true" />}
      >
        Manage hours
      </NoticeLink>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-block" tabIndex={0} />}>
        <Button variant="outline" disabled>
          <Clock data-icon="inline-start" aria-hidden="true" />
          Manage hours
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Editing window closed or all sessions published.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The one notice that matters for where the event is right now, with the
 * actions an organizer needs at that moment.
 */
export function CreatorDashboardNotices({
  project,
  phase,
  hasActiveUnpublishedSessions,
  unpublishedSummary,
  onOpenQrCodes,
}: {
  project: Project;
  phase: CreatorDashboardPhase;
  hasActiveUnpublishedSessions: boolean;
  unpublishedSummary: string | null;
  onOpenQrCodes: () => void;
}) {
  const { isCancelled, isStartingSoon, isInProgress, isCompleted } = phase;
  const { isCheckInOpen } = phase;
  const method = project.verification_method;
  const isQr = method === "qr-code";
  const isManual = method === "manual";
  const base = `/projects/${project.id}`;

  if (isCancelled) {
    return null;
  }

  const qrButton = (label: string) => (
    <Button variant="outline" onClick={onOpenQrCodes}>
      <QrCode data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  );
  const attendanceLink = (
    <NoticeLink
      href={`${base}/attendance`}
      icon={<UserCheck data-icon="inline-start" aria-hidden="true" />}
    >
      Manage attendance
    </NoticeLink>
  );

  return (
    <>
      {method === "signup-only" && (
        <>
          {isStartingSoon && (
            <Alert variant="info">
              <Info aria-hidden="true" />
              <AlertTitle>Event starting soon!</AlertTitle>
              <AlertDescription>
                Your signup-only event starts within 24 hours. Consider pausing
                signups if you&apos;re no longer accepting volunteers. You can
                also view or print the current signup list from the Manage
                Signups page.
                <NoticeActions>
                  <NoticeLink
                    href={`${base}/signups`}
                    icon={<Pause data-icon="inline-start" aria-hidden="true" />}
                  >
                    Pause/view signups
                  </NoticeLink>
                  <NoticeLink
                    href={`${base}/signups`}
                    icon={
                      <Printer data-icon="inline-start" aria-hidden="true" />
                    }
                  >
                    Print list
                  </NoticeLink>
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
          {isInProgress && (
            <Alert variant="warning">
              <Info aria-hidden="true" />
              <AlertTitle>Event in progress</AlertTitle>
              <AlertDescription>
                Your signup-only event is currently ongoing based on the
                scheduled time.
              </AlertDescription>
            </Alert>
          )}
          {isCompleted && (
            <Alert variant="success">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Event completed</AlertTitle>
              <AlertDescription>
                {hasActiveUnpublishedSessions
                  ? "Your signup-only event has finished. Please review and finalize volunteer hours within 48 hours of the event end time to generate certificates."
                  : "Your signup-only event has finished, and the window for managing volunteer hours has closed or all sessions are published."}
                {unpublishedSummary ? ` ${unpublishedSummary}` : null}
                <NoticeActions>
                  <ManageHoursAction
                    projectId={project.id}
                    enabled={hasActiveUnpublishedSessions}
                  />
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {(isQr || isManual) && (
        <>
          {isStartingSoon && !isCheckInOpen && (
            <Alert variant="info">
              <Info aria-hidden="true" />
              <AlertTitle>Event starting soon!</AlertTitle>
              <AlertDescription>
                Your event starts within 24 hours.
                {isQr &&
                  " QR codes for check-in will be available 2 hours before the start time."}
                {isManual && " Prepare for manual volunteer check-in."}
                <NoticeActions>
                  {isQr && qrButton("Preview QR codes")}
                  <NoticeLink
                    href={`${base}/signups`}
                    icon={<Users data-icon="inline-start" aria-hidden="true" />}
                  >
                    View signups
                  </NoticeLink>
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
          {isCheckInOpen && !isInProgress && !isCompleted && (
            <Alert variant="info">
              <Hourglass aria-hidden="true" />
              <AlertTitle>Check-in window open!</AlertTitle>
              <AlertDescription>
                Volunteer check-in is available starting 2 hours before the
                event.
                {isQr && " Ensure QR codes are accessible."}
                {isManual && " Be ready to check volunteers in manually."}
                <NoticeActions>
                  {isQr && qrButton("View QR codes")}
                  {attendanceLink}
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
          {isInProgress && (
            <Alert variant="warning">
              <Info aria-hidden="true" />
              <AlertTitle>Event in progress</AlertTitle>
              <AlertDescription>
                Your event is currently ongoing. Manage check-ins and view
                attendance records.
                <NoticeActions>
                  {isQr && qrButton("View QR codes")}
                  {attendanceLink}
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
          {isCompleted && (
            <Alert variant={hasActiveUnpublishedSessions ? "info" : "success"}>
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Event completed</AlertTitle>
              <AlertDescription>
                {hasActiveUnpublishedSessions
                  ? "Your event has finished. Please review, edit, and publish volunteer hours within 48 hours of the event end time to generate certificates. If you don't edit, hours will be published automatically."
                  : "Your event has finished, and the window for managing volunteer hours has closed or all sessions are published. You can still view the final attendance records."}
                {unpublishedSummary ? ` ${unpublishedSummary}` : null}
                <NoticeActions>
                  {attendanceLink}
                  <ManageHoursAction
                    projectId={project.id}
                    enabled={hasActiveUnpublishedSessions}
                  />
                </NoticeActions>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {method === "auto" && (
        <Alert>
          <Zap aria-hidden="true" />
          <AlertTitle>Automatic check-in enabled</AlertTitle>
          <AlertDescription>
            Volunteer check-in is automatic. Hours are recorded based on the
            schedule. Manual editing is not available for this project type.
            <NoticeActions>
              <NoticeLink
                href={`${base}/attendance`}
                icon={<Users data-icon="inline-start" aria-hidden="true" />}
              >
                View attendance
              </NoticeLink>
            </NoticeActions>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
