"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inspectAttendanceIntervals } from "@/lib/projects/paper-signup/intervals";
import {
  certificateOf,
  creditedMinutes,
  emailOf,
  minutesLabel,
  nameOf,
  savedDraft,
} from "./useHoursAttendance";
import type { HoursEdits } from "./useHoursEdits";
import type { HoursPublishing } from "./useHoursPublishing";
import type { HoursSession } from "./useHoursSessions";

function SessionStatusBadge({ session }: { session: HoursSession }) {
  if (session.published) return <Badge variant="success">Published</Badge>;
  if (session.status === "upcoming")
    return <Badge variant="info">Upcoming</Badge>;
  if (session.status === "in-progress")
    return <Badge variant="warning">In progress</Badge>;
  if (session.status === "invalid")
    return <Badge variant="warning">Schedule needs review</Badge>;
  return <Badge variant="neutral">Not published</Badge>;
}

function visitTime(value: string | null, timezone: string, missing: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-US", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      })
    : missing;
}

export function HoursSessionCard({
  session,
  timezone,
  disabled,
  edits,
  publishing,
}: {
  session: HoursSession;
  timezone: string;
  disabled: boolean;
  edits: HoursEdits;
  publishing: HoursPublishing;
}) {
  const { summary } = session;
  return (
    <Card>
      <CardHeader>
        <div className="col-span-full flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{session.name}</CardTitle>
            <SessionStatusBadge session={session} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.published ? (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => void publishing.resend(session)}
              >
                {publishing.busy === session.id && (
                  <Spinner data-icon="inline-start" />
                )}
                Retry certificate delivery
              </Button>
            ) : (
              <Button
                disabled={
                  disabled ||
                  !session.readyCount ||
                  session.status !== "completed"
                }
                onClick={() => publishing.setConfirmSessionId(session.id)}
              >
                Review and publish {session.readyCount}{" "}
                {session.readyCount === 1 ? "volunteer" : "volunteers"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1 text-sm">
          <p>
            {session.attendees.length}{" "}
            {session.attendees.length === 1 ? "volunteer" : "volunteers"} ·{" "}
            {minutesLabel(summary.awardedMinutes)} awarded
          </p>
          {summary.pendingCount > 0 && (
            <p className="text-muted-foreground">
              {minutesLabel(summary.recordedMinutes)} recorded for{" "}
              {summary.pendingCount}{" "}
              {summary.pendingCount === 1 ? "volunteer" : "volunteers"} awaiting
              publication.
            </p>
          )}
          {!session.published && session.status !== "completed" && (
            <p className="text-muted-foreground">
              {session.window
                ? "Hours can be published after this session ends. Refresh then to publish reviewed attendance."
                : "This session needs a valid schedule before hours can be published."}
            </p>
          )}
          {!session.published &&
            session.readyCount !== session.pendingCount && (
              <p className="text-muted-foreground">
                {session.pendingCount - session.readyCount}{" "}
                {session.pendingCount - session.readyCount === 1
                  ? "volunteer still needs"
                  : "volunteers still need"}{" "}
                valid attendance times.
              </p>
            )}
          {session.published && (
            <p className="text-muted-foreground">
              Correct hours to update an existing certificate. Recording late
              attendance adds its award to this published session.
            </p>
          )}
        </div>
        {session.visibleAttendees.length ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Volunteer</TableHead>
                  <TableHead>Attendance visits</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {session.visibleAttendees.map((signup) => {
                  const certificate = certificateOf(signup);
                  const draft = savedDraft(signup);
                  const minutes = certificate
                    ? creditedMinutes(signup)
                    : inspectAttendanceIntervals(draft.intervals).minutes;
                  return (
                    <TableRow key={signup.id}>
                      <TableCell className="align-top">
                        <p className="font-medium">{nameOf(signup)}</p>
                        <p className="text-muted-foreground text-xs">
                          {signup.user_id ? "Account" : "Guest"}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {emailOf(signup) || "Email missing"}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="grid gap-2">
                          {draft.intervals.map((interval, index) => (
                            <p key={index} className="text-sm">
                              <span className="font-medium">
                                Visit {index + 1}:
                              </span>
                              <br />
                              {visitTime(
                                interval.checkIn,
                                timezone,
                                "Sign-in missing",
                              )}
                              <br />
                              to{" "}
                              {visitTime(
                                interval.checkOut,
                                timezone,
                                "Sign-out missing",
                              )}
                            </p>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="align-top font-medium tabular-nums">
                        {minutesLabel(minutes)}
                        {draft.intervals.length > 1 && (
                          <p className="text-muted-foreground text-xs font-normal">
                            Excluding breaks
                          </p>
                        )}
                        <p className="text-muted-foreground text-xs font-normal">
                          {certificate ? "Awarded" : "Recorded"}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap justify-end gap-2">
                          {certificate && (
                            <Button
                              variant="outline"
                              render={
                                <Link
                                  href={`/certificates/${certificate.id}`}
                                />
                              }
                            >
                              View certificate
                            </Button>
                          )}
                          {certificate?.canResendCorrection && (
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() =>
                                void publishing.sendCorrection(certificate)
                              }
                            >
                              Send updated certificate
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            disabled={disabled}
                            onClick={() => edits.open(signup)}
                          >
                            {certificate ? "Correct hours" : "Edit visits"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {session.attendees.length
              ? "No volunteers match this search."
              : "No approved volunteers or recorded attendance for this session yet. Add a walk-in or scan a completed sheet to begin."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
