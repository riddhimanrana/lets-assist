"use client";

import { format } from "date-fns";
import { Clock, FileText, Info, Mail, Minus, Plus } from "lucide-react";

import type { ProjectSignup } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { calculateHoursDuration as calculateDuration } from "./hours-duration";
import type { HoursEdits } from "./useHoursEdits";
import type { HoursPublishing } from "./useHoursPublishing";
import type { HoursSession } from "./useHoursSessions";

const EMPTY_EDIT = { check_in_time: null, check_out_time: null };

function SessionStatusBadge({
  status,
  isPublished,
}: {
  status: HoursSession["status"];
  isPublished: boolean;
}) {
  if (isPublished) return <Badge variant="success">Published</Badge>;
  if (status === "upcoming") return <Badge variant="info">Upcoming</Badge>;
  if (status === "in-progress")
    return <Badge variant="warning">In progress</Badge>;
  if (status === "editing")
    return <Badge variant="warning">Editing window open</Badge>;
  if (status === "completed")
    return <Badge variant="secondary">Completed</Badge>;
  return null;
}

/** Adds the same number of minutes to every check-out time of a session. */
function BatchAdjustDialog({
  sessionId,
  affectedCount,
  edits,
}: {
  sessionId: string;
  affectedCount: number;
  edits: HoursEdits;
}) {
  const applying = edits.applyingBatchAdjustment[sessionId];

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Clock data-icon="inline-start" aria-hidden="true" />
            Adjust all times
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Batch adjust check-out times</DialogTitle>
          <DialogDescription>
            Add time to all volunteer check-out times in this session. This is
            useful when volunteers stayed longer than initially recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="icon"
              aria-label="Remove 5 minutes"
              onClick={() =>
                edits.setBatchMinutesAdjustment((prev) => Math.max(5, prev - 5))
              }
              disabled={applying}
            >
              <Minus aria-hidden="true" />
            </Button>
            <div className="grid min-w-20 justify-items-center">
              <span className="text-2xl font-semibold tabular-nums">
                {edits.batchMinutesAdjustment}
              </span>
              <span className="text-muted-foreground text-sm">minutes</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Add 5 minutes"
              onClick={() =>
                edits.setBatchMinutesAdjustment((prev) =>
                  Math.min(120, prev + 5),
                )
              }
              disabled={applying}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <p className="text-muted-foreground text-center text-sm">
            This will extend the check-out time for {affectedCount} volunteers
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            onClick={() =>
              edits.handleBatchAdjustment(
                sessionId,
                edits.batchMinutesAdjustment,
              )
            }
            disabled={applying}
          >
            {applying ? (
              <>
                <Spinner data-icon="inline-start" />
                Applying...
              </>
            ) : (
              "Apply adjustment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResendCertificatesDialog({
  sessionId,
  publishing,
}: {
  sessionId: string;
  publishing: HoursPublishing;
}) {
  const resending = publishing.resendingSessions[sessionId];

  return (
    <Dialog
      open={publishing.showResendDialog === sessionId}
      onOpenChange={(open) => {
        if (!open) publishing.setShowResendDialog(null);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" disabled={resending}>
            {resending ? (
              <>
                <Spinner data-icon="inline-start" />
                Resending...
              </>
            ) : (
              <>
                <Mail data-icon="inline-start" aria-hidden="true" />
                Resend
              </>
            )}
          </Button>
        }
        onClick={() => publishing.setShowResendDialog(sessionId)}
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resend certificates</DialogTitle>
          <DialogDescription>
            Resend certificate emails to volunteers who have already received
            their certificates. This is useful for corrections or if volunteers
            didn&apos;t receive their original email.
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Are you sure you want to resend all certificates for this session to
          volunteers?
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            onClick={() => publishing.handleResendCertificates(sessionId)}
            disabled={resending}
          >
            {resending ? (
              <>
                <Spinner data-icon="inline-start" />
                Resending...
              </>
            ) : (
              "Resend all certificates"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One session: its phase, the bulk and publish actions in the header, and the
 * editable check-in and check-out times for everyone who attended.
 */
export function HoursSessionCard({
  session,
  sessionSignups,
  isPublished,
  edits,
  publishing,
}: {
  session: HoursSession;
  sessionSignups: ProjectSignup[];
  isPublished: boolean;
  edits: HoursEdits;
  publishing: HoursPublishing;
}) {
  const { editedTimes } = edits;
  const hasSignups = sessionSignups.length > 0;
  const isPublishing = publishing.publishingSessions[session.id] || false;
  const hasInvalidTimes =
    hasSignups &&
    sessionSignups.some((signup) => {
      const edit = editedTimes[signup.id] || EMPTY_EDIT;
      return !calculateDuration(edit.check_in_time, edit.check_out_time)
        .isValid;
    });
  // Publishing needs at least one volunteer with both times recorded.
  const hasValidHoursData =
    hasSignups &&
    sessionSignups.some((signup) => {
      const edit = editedTimes[signup.id] || EMPTY_EDIT;
      return edit.check_in_time && edit.check_out_time;
    });
  const canEdit = session.status === "editing" && hasSignups && !isPublished;

  return (
    <Card>
      <CardHeader>
        <div className="col-span-full flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{session.name}</CardTitle>
            <SessionStatusBadge
              status={session.status}
              isPublished={isPublished}
            />
          </div>
          {(canEdit || isPublished) && (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <>
                  <BatchAdjustDialog
                    sessionId={session.id}
                    affectedCount={
                      sessionSignups.filter(
                        (signup) => editedTimes[signup.id]?.check_out_time,
                      ).length
                    }
                    edits={edits}
                  />
                  <Button
                    onClick={() => publishing.initiatePublishHours(session.id)}
                    disabled={
                      isPublishing || !hasValidHoursData || hasInvalidTimes
                    }
                  >
                    {isPublishing ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        Publishing...
                      </>
                    ) : (
                      "Publish hours"
                    )}
                  </Button>
                </>
              )}
              {isPublished && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => publishing.loadCertificatesData(session.id)}
                    disabled={publishing.loadingCertificates}
                  >
                    {publishing.loadingCertificates ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <FileText data-icon="inline-start" aria-hidden="true" />
                        View certificates
                      </>
                    )}
                  </Button>
                  <ResendCertificatesDialog
                    sessionId={session.id}
                    publishing={publishing}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        {edits.showBatchAdjustment[session.id] &&
          !edits.applyingBatchAdjustment[session.id] && (
            <p className="text-muted-foreground text-sm">
              This will add{" "}
              <span className="text-foreground font-medium">
                {edits.batchMinutesAdjustment} minutes
              </span>{" "}
              to all volunteer check-out times in this session. Useful for
              extending hours when volunteers stayed longer than initially
              recorded.
            </p>
          )}

        {hasInvalidTimes && (
          <Alert variant="destructive">
            <AlertTitle>Invalid hours detected</AlertTitle>
            <AlertDescription>
              Some volunteers have invalid hours (negative or over 24 hours).
              Please fix these before publishing.
            </AlertDescription>
          </Alert>
        )}

        {isPublished ? (
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground">
              This session&apos;s hours have been published and certificates
              generated.
            </span>{" "}
            Hours can no longer be modified. Contact support for any needed
            changes.
          </p>
        ) : hasSignups ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-35">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      Duration
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span tabIndex={0} aria-label="Duration info">
                              <Info className="size-4" aria-hidden="true" />
                            </span>
                          }
                        />
                        <TooltipContent side="top" align="center">
                          Times may be off by ±1 minute due to rounding seconds
                          to the nearest minute.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionSignups.map((signup) => {
                  const isRegistered = !!signup.user_id;
                  const name = isRegistered
                    ? signup.profile?.full_name
                    : signup.anonymous_signup?.name;
                  const email = isRegistered
                    ? signup.profile?.email
                    : signup.anonymous_signup?.email;
                  const currentEdit = editedTimes[signup.id] || EMPTY_EDIT;
                  const duration = calculateDuration(
                    currentEdit.check_in_time,
                    currentEdit.check_out_time,
                  );
                  const hasBeenEdited =
                    currentEdit.check_in_time !== signup.check_in_time ||
                    currentEdit.check_out_time !== signup.check_out_time;

                  return (
                    <TableRow key={signup.id}>
                      <TableCell className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {name || "N/A"}
                          {hasBeenEdited && (
                            <Badge variant="secondary">Edited</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{email || "N/A"}</TableCell>
                      {(["check_in_time", "check_out_time"] as const).map(
                        (field) => (
                          <TableCell key={field}>
                            <div className="w-32">
                              <TimePicker
                                value={
                                  currentEdit[field]
                                    ? format(
                                        new Date(currentEdit[field] as string),
                                        "HH:mm",
                                      )
                                    : ""
                                }
                                onChangeAction={(time) =>
                                  edits.handleTimeChange(signup.id, field, time)
                                }
                                disabled={session.status !== "editing"}
                              />
                            </div>
                          </TableCell>
                        ),
                      )}
                      <TableCell
                        className={
                          duration.isValid
                            ? "font-medium tabular-nums"
                            : "text-destructive font-medium tabular-nums"
                        }
                      >
                        {duration.text}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {session.status === "upcoming" &&
              "This session hasn't started yet. Check back after the session is complete."}
            {session.status === "in-progress" &&
              "This session is currently in progress. Volunteer hours will be available after the session ends."}
            {(session.status === "editing" || session.status === "completed") &&
              "No volunteers attended this session. There are no hours to manage."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
