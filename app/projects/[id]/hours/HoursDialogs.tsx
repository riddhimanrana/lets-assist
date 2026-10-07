"use client";

import { format } from "date-fns";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { HoursPublishing } from "./useHoursPublishing";

const formatMinutes = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** Confirms what was published and what volunteers receive next. */
export function HoursPublishSuccessDialog({
  publishing,
}: {
  publishing: HoursPublishing;
}) {
  const {
    certificatesCreated,
    totalVolunteers,
    registeredVolunteers,
    anonymousVolunteers,
    emailsSent,
    skippedEmailCount,
    failedEmailCount,
  } = publishing;

  return (
    <Dialog
      open={publishing.showPublishSuccessModal}
      onOpenChange={(open) => {
        publishing.setShowPublishSuccessModal(open);
        if (!open) {
          publishing.setPublishSummary(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Hours published for {publishing.currentPublishedSessionName}
          </DialogTitle>
          <DialogDescription>
            Volunteer hours have been finalized and certificates generated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          <dl className="divide-y border-y">
            <SummaryRow
              label="Certificates generated"
              value={`${certificatesCreated} certificate${certificatesCreated !== 1 ? "s" : ""} for ${totalVolunteers} volunteer${totalVolunteers !== 1 ? "s" : ""}`}
            />
            <SummaryRow
              label="Volunteer breakdown"
              value={`${registeredVolunteers} registered • ${anonymousVolunteers} anonymous`}
            />
            <SummaryRow
              label="Email notifications"
              value={
                emailsSent > 0
                  ? `Sent ${emailsSent} notification email${emailsSent !== 1 ? "s" : ""}.`
                  : "No notification emails were sent."
              }
            />
          </dl>

          {skippedEmailCount > 0 && (
            <p className="text-muted-foreground">
              Skipped {skippedEmailCount} volunteer
              {skippedEmailCount !== 1 ? "s" : ""} without email addresses.
            </p>
          )}
          {failedEmailCount > 0 && (
            <Alert variant="warning">
              <AlertDescription>
                {failedEmailCount} email{failedEmailCount !== 1 ? "s" : ""}{" "}
                failed to send. You can retry later.
              </AlertDescription>
            </Alert>
          )}

          <p className="text-muted-foreground">
            PDF certificates are ready, and volunteer access is now live.
          </p>

          <div className="grid gap-1">
            <p className="font-medium">Verification info</p>
            <p className="text-muted-foreground">
              Each certificate includes a unique ID and verification link inside
              the PDF/email.
            </p>
            <code className="bg-muted rounded-md px-2 py-1 font-mono text-xs break-all select-all">
              {publishing.certificateBaseUrl}/{"<certificate-id>"}
            </code>
          </div>

          <div className="grid gap-1">
            <p className="font-medium">What happens next?</p>
            <ul className="text-muted-foreground grid list-disc gap-1 pl-5">
              <li>
                <span className="text-foreground">
                  Volunteers with accounts:
                </span>{" "}
                Can access certificates via their profile or the project page
              </li>
              <li>
                <span className="text-foreground">Anonymous volunteers:</span>{" "}
                Receive an email with a direct certificate link (if an email was
                provided)
              </li>
              <li>
                <span className="text-foreground">Verification:</span> Anyone
                with a certificate link can verify it using the certificate page
              </li>
            </ul>
            <p className="text-muted-foreground">
              If volunteers need help accessing their certificates, direct them
              to contact you or support@lets-assist.com
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The last check before hours become final. */
export function HoursConfirmPublishDialog({
  publishing,
}: {
  publishing: HoursPublishing;
}) {
  const { confirmPublishSessionId, confirmPublishCount } = publishing;

  return (
    <Dialog
      open={confirmPublishSessionId !== null}
      onOpenChange={(open) =>
        !open && publishing.setConfirmPublishSessionId(null)
      }
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish volunteer hours</DialogTitle>
          <DialogDescription>
            You are about to publish volunteer hours and generate official
            certificates for <strong>{confirmPublishCount}</strong> volunteer
            {confirmPublishCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Alert variant="warning">
            <AlertTitle>Important:</AlertTitle>
            <AlertDescription>
              This action is final. Once published, these hours cannot be
              modified. Volunteers will have access to their certificates
              immediately.
            </AlertDescription>
          </Alert>

          <p className="text-muted-foreground text-sm">
            For any changes after publishing, you&apos;ll need to contact
            support at{" "}
            <a
              href="mailto:support@lets-assist.com"
              className="text-foreground underline underline-offset-4"
            >
              support@lets-assist.com
            </a>
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            onClick={() =>
              confirmPublishSessionId &&
              publishing.handlePublishHours(confirmPublishSessionId)
            }
          >
            Confirm & publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The hours behind each certificate of a published session. */
export function HoursCertificatesDialog({
  publishing,
}: {
  publishing: HoursPublishing;
}) {
  const data = publishing.certificatesModalData;
  const totalMinutes = (data?.volunteers ?? []).reduce(
    (sum, v) =>
      sum +
      (typeof v.durationMinutes === "number" && !isNaN(v.durationMinutes)
        ? v.durationMinutes
        : 0),
    0,
  );

  return (
    <Dialog
      open={publishing.showCertificatesModal}
      onOpenChange={publishing.setShowCertificatesModal}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Certificate details</DialogTitle>
          <DialogDescription>
            {data ? (
              <>
                Session:{" "}
                <strong className="wrap-break-word">{data.sessionName}</strong>{" "}
                • {data.volunteers.length} volunteer
                {data.volunteers.length !== 1 ? "s" : ""}
              </>
            ) : (
              "Loading certificate details..."
            )}
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="grid gap-4">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Email
                    </TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.volunteers.length > 0 ? (
                    data.volunteers.map((volunteer, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          <div>{volunteer.name}</div>
                          <div className="text-muted-foreground text-sm font-normal sm:hidden">
                            {volunteer.email}
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {volunteer.email}
                        </TableCell>
                        {[volunteer.checkInTime, volunteer.checkOutTime].map(
                          (time, timeIndex) => (
                            <TableCell key={timeIndex} className="tabular-nums">
                              <div>{format(new Date(time), "MMM d")}</div>
                              <div className="text-muted-foreground text-sm">
                                {format(new Date(time), "h:mm a")}
                              </div>
                            </TableCell>
                          ),
                        )}
                        <TableCell className="text-right font-medium tabular-nums">
                          {volunteer.hours}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-8 text-center"
                      >
                        No volunteers with valid hours found for this session.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {data.volunteers.length > 0 && (
              <dl className="grid grid-cols-3 divide-x rounded-lg border text-sm">
                {[
                  ["Total volunteers", String(data.volunteers.length)],
                  ["Total hours", formatMinutes(totalMinutes)],
                  [
                    "Average hours",
                    formatMinutes(
                      Math.round(totalMinutes / data.volunteers.length),
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-0.5 px-3 py-2">
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <Spinner />
            Loading certificate data...
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
