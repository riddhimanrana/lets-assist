"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { StatStrip } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getInvitationDurationLabel,
  type InvitationDuration,
} from "@/lib/organization/invitation-utils";
import type {
  ContactImportCreateResponse,
  ContactImportParseSummary,
  ContactImportRole,
  OrganizationContactImportJob,
} from "@/types/contact-import";
import type { BulkInviteResponse } from "@/types/invitation";

import type { FailedRowPreview } from "./bulk-import-shared";

/** One line in a result list: an icon, the address, and what happened. */
function ResultRow({
  tone,
  label,
  detail,
}: {
  tone: "success" | "destructive" | "warning" | "neutral";
  label: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        {tone === "success" ? (
          <CheckCircle2 className="text-success size-4 shrink-0" />
        ) : tone === "destructive" ? (
          <XCircle className="text-destructive size-4 shrink-0" />
        ) : tone === "warning" ? (
          <AlertCircle className="text-warning size-4 shrink-0" />
        ) : null}
        <span className="truncate font-mono text-sm">{label}</span>
      </span>
      {detail ? (
        <span className="text-muted-foreground text-xs">{detail}</span>
      ) : null}
    </li>
  );
}

function ResultList({ children }: { children: ReactNode }) {
  return <ul className="divide-y rounded-md border">{children}</ul>;
}

export function BulkImportPreviewStep({
  emails,
  role,
  invitationDuration,
  isPending,
  onBack,
  onSubmit,
}: {
  emails: string[];
  role: ContactImportRole;
  invitationDuration: InvitationDuration;
  isPending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Review invitations</DialogTitle>
        <DialogDescription>
          {emails.length} {emails.length === 1 ? "person" : "people"} will be
          invited as {role}. Invitations expire in{" "}
          {getInvitationDurationLabel(invitationDuration)}.
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-75">
        <ResultList>
          {emails.map((email, index) => (
            <ResultRow key={index} tone="neutral" label={email} />
          ))}
        </ResultList>
      </ScrollArea>

      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Sending invitations...
            </>
          ) : (
            `Send ${emails.length} invitation${emails.length !== 1 ? "s" : ""}`
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

export function BulkImportManualResultStep({
  result,
  onDone,
}: {
  result: BulkInviteResponse;
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {result.successful === result.total
            ? "All invitations sent"
            : result.successful > 0
              ? "Invitations partially sent"
              : "Failed to send invitations"}
        </DialogTitle>
        <DialogDescription>
          {result.successful} of {result.total} invitation
          {result.total !== 1 ? "s" : ""} sent successfully.
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-75">
        <ResultList>
          {result.results.map((item, index) => (
            <ResultRow
              key={index}
              tone={item.success ? "success" : "destructive"}
              label={item.email}
              detail={item.error}
            />
          ))}
        </ResultList>
      </ScrollArea>

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}

export function BulkImportProcessingStep({
  importJob,
  parseSummary,
  progressPercent,
  isProcessingImport,
}: {
  importJob: OrganizationContactImportJob;
  parseSummary: ContactImportParseSummary | null;
  progressPercent: number;
  isProcessingImport: boolean;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Processing import</DialogTitle>
        <DialogDescription>
          Sending invitations in safe batches. You can keep this open to track
          progress.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        {parseSummary && (
          <StatStrip
            items={[
              { label: "Valid rows", value: parseSummary.validRows },
              { label: "Invalid rows", value: parseSummary.invalidRows },
              { label: "Duplicate rows", value: parseSummary.duplicateRows },
              {
                label: "Skipped empty rows",
                value: parseSummary.skippedEmptyRows,
              },
            ]}
          />
        )}

        <Progress value={progressPercent}>
          <div className="flex w-full items-center">
            <ProgressLabel>Processed valid contacts</ProgressLabel>
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">
              {importJob.processed_rows}/{Math.max(importJob.valid_rows, 0)}
            </span>
          </div>
        </Progress>

        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {isProcessingImport
            ? "Processing next batch..."
            : "Finalizing import results..."}
        </div>
      </div>
    </>
  );
}

export function BulkImportJobResultStep({
  importJob,
  invalidRowsPreview,
  failedRowsPreview,
  onDone,
}: {
  importJob: OrganizationContactImportJob;
  invalidRowsPreview: ContactImportCreateResponse["invalidRowsPreview"];
  failedRowsPreview: FailedRowPreview[];
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {importJob.status === "completed"
            ? "Import completed"
            : importJob.status === "failed"
              ? "Import failed"
              : "Import finished"}
        </DialogTitle>
        <DialogDescription>
          {importJob.successful_invites} invitation
          {importJob.successful_invites !== 1 ? "s" : ""} sent out of{" "}
          {importJob.valid_rows} valid contact
          {importJob.valid_rows !== 1 ? "s" : ""}.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <StatStrip
          items={[
            {
              label: "Successful invites",
              value: importJob.successful_invites,
            },
            { label: "Failed or skipped", value: importJob.failed_invites },
            { label: "Processed rows", value: importJob.processed_rows },
            {
              label: "Job status",
              value: (
                <Badge
                  variant={
                    importJob.status === "completed"
                      ? "success"
                      : importJob.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="capitalize"
                >
                  {importJob.status}
                </Badge>
              ),
            },
          ]}
        />

        {invalidRowsPreview?.length || failedRowsPreview.length ? (
          <ScrollArea className="max-h-64">
            <div className="grid gap-4">
              {invalidRowsPreview && invalidRowsPreview.length > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">
                    Invalid rows (parse stage)
                  </h3>
                  <ResultList>
                    {invalidRowsPreview.map((row) => (
                      <ResultRow
                        key={`invalid-${row.rowNumber}-${row.reason}`}
                        tone="destructive"
                        label={`Row ${row.rowNumber}: ${row.email || "(empty email)"}`}
                        detail={row.reason}
                      />
                    ))}
                  </ResultList>
                </div>
              )}

              {failedRowsPreview.length > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">
                    Failed or skipped rows (delivery stage)
                  </h3>
                  <ResultList>
                    {failedRowsPreview.map((row) => (
                      <ResultRow
                        key={`failed-${row.row_number}-${row.status}-${row.email}`}
                        tone={
                          row.status === "failed" ? "destructive" : "warning"
                        }
                        label={`Row ${row.row_number}: ${row.email}`}
                        detail={row.error || row.status}
                      />
                    ))}
                  </ResultList>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <Alert variant="success">
            <CheckCircle2 />
            <AlertTitle>No row-level issues</AlertTitle>
            <AlertDescription>
              All valid contacts in this batch were invited successfully.
            </AlertDescription>
          </Alert>
        )}

        {importJob.last_error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Latest job error</AlertTitle>
            <AlertDescription>{importJob.last_error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}
