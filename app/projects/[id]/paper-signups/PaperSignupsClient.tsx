"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileWarning } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { startManualAttendance } from "./manual-actions";
import { ScheduleSlotStep } from "./ScheduleSlotStep";
import { CaptureStep } from "./CaptureStep";
import { ReviewTable } from "./ReviewTable";
import { discardPaperScanBatch, retryPaperScanCertificates } from "./actions";

export interface PaperScanSlotOption {
  id: string;
  label: string;
  windowStartsAt: number;
  windowEndsAt: number;
}

export interface PaperScanBatchView {
  id: string;
  scheduleId: string;
  status: "draft" | "extracting" | "review" | "failed";
  imageCount: number;
  inputMethod?: "scan" | "manual";
}

export interface PaperScanRowView {
  id: string;
  sheetRowNumber: number;
  imageId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  signaturePresent: boolean;
  overallConfidence: number;
  fieldConfidence: {
    name: number;
    email: number;
    phone: number;
    timeIn: number;
    timeOut: number;
  };
  matchKind: string;
  matchSignupId: string | null;
  matchScore: number | null;
  matchReasons: string[];
  decision: "pending" | "include" | "exclude";
  outcome: string;
  outcomeDetail: string | null;
  attendanceIntervals: import("@/lib/projects/paper-signup/intervals").AttendanceInterval[];
  reviewAcknowledged: boolean;
  identityConfirmed: boolean;
  timeExceptionReason: string | null;
  reviewRevision: number;
}

export interface CommitSummary {
  created: number;
  updated: number;
  rosterOnly: number;
  overCapacity: number;
  failed: Array<{ rowId: string; detail: string }>;
  certificatesIssued: number;
  certificateErrors: string[];
  notificationsQueued: number;
}

interface PaperSignupsClientProps {
  projectId: string;
  projectTitle: string;
  projectTimezone: string;
  projectStatus: string;
  publishedState: Record<string, boolean>;
  slotOptions: PaperScanSlotOption[];
  initialBatch: PaperScanBatchView | null;
  initialRows: PaperScanRowView[];
  activeWindow: { startsAt: number; endsAt: number } | null;
  initialMode?: "scan" | "manual";
}

type Step = "slot" | "capture" | "review" | "done";

export function PaperSignupsClient({
  projectId,
  projectTitle,
  projectTimezone,
  projectStatus,
  publishedState,
  slotOptions,
  initialBatch,
  initialRows,
  activeWindow,
  initialMode = "scan",
}: PaperSignupsClientProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [manualRequestId, setManualRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const startManual = async () => {
    if (!selectedSlotId) return;
    setStarting(true);
    try {
      const result = await startManualAttendance({
        projectId,
        scheduleId: selectedSlotId,
        requestId: manualRequestId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setBatch({
        id: result.batchId,
        scheduleId: selectedSlotId,
        status: "review",
        imageCount: 0,
        inputMethod: "manual",
      });
      setManualRequestId(crypto.randomUUID());
      setStep("review");
      router.refresh();
    } finally {
      setStarting(false);
    }
  };

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    initialBatch?.scheduleId ?? null,
  );
  const [batch, setBatch] = useState<PaperScanBatchView | null>(initialBatch);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);
  const [retryingCertificates, setRetryingCertificates] = useState(false);

  const [step, setStep] = useState<Step>(() => {
    if (initialBatch?.status === "review") return "review";
    if (initialBatch) return "capture";
    return "slot";
  });

  const selectedSlot = useMemo(
    () => slotOptions.find((option) => option.id === selectedSlotId) ?? null,
    [slotOptions, selectedSlotId],
  );

  const handleDiscard = async () => {
    if (!batch) return;
    setDiscarding(true);
    const result = await discardPaperScanBatch({
      projectId,
      batchId: batch.id,
    });
    setDiscarding(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Scan discarded.");
    setBatch(null);
    setStep("slot");
    router.refresh();
  };

  const retryCertificates = async () => {
    if (!batch || !commitSummary) return;
    setRetryingCertificates(true);
    const result = await retryPaperScanCertificates({
      projectId,
      batchId: batch.id,
    });
    setRetryingCertificates(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setCommitSummary((current) =>
      current
        ? {
            ...current,
            certificatesIssued:
              current.certificatesIssued + result.certificatesIssued,
            certificateErrors: result.certificateErrors,
          }
        : current,
    );
    if (result.certificateErrors.length === 0) {
      toast.success("Certificate issuance retry completed.");
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to project"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            Paper attendance
          </h1>
          <p className="text-sm text-muted-foreground">{projectTitle}</p>
        </div>
      </div>

      {projectStatus !== "completed" && step !== "done" && (
        <Alert className="mb-6">
          <FileWarning className="size-4" />
          <AlertTitle>This event hasn&apos;t finished yet</AlertTitle>
          <AlertDescription>
            Paper sheets are usually scanned after the event ends. You can still
            scan now. Actual times outside the session need a reviewed reason.
          </AlertDescription>
        </Alert>
      )}

      {step === "slot" && (
        <div className="space-y-3">
          <ScheduleSlotStep
            slotOptions={slotOptions}
            timezone={projectTimezone}
            selectedSlotId={selectedSlotId}
            manual={initialMode === "manual"}
            busy={starting}
            onSelect={setSelectedSlotId}
            onContinue={() =>
              initialMode === "manual"
                ? void startManual()
                : selectedSlotId && setStep("capture")
            }
          />
          {initialMode !== "manual" && (
            <Button
              variant="outline"
              disabled={!selectedSlotId || starting}
              onClick={startManual}
            >
              {starting ? "Opening attendance…" : "Add attendance manually"}
            </Button>
          )}
        </div>
      )}

      {step === "capture" && selectedSlot && (
        <CaptureStep
          projectId={projectId}
          slot={selectedSlot}
          existingBatch={batch}
          onBack={() => setStep("slot")}
          onExtracted={(newBatch) => {
            setBatch(newBatch);
            router.refresh();
            setStep("review");
          }}
        />
      )}

      {step === "review" && batch && (
        <ReviewTable
          projectId={projectId}
          batch={batch}
          initialRows={initialRows}
          timezone={projectTimezone}
          window={
            activeWindow ??
            (selectedSlot
              ? {
                  startsAt: selectedSlot.windowStartsAt,
                  endsAt: selectedSlot.windowEndsAt,
                }
              : null)
          }
          sessionPublished={Boolean(
            publishedState[batch.scheduleId] ||
            publishedState[
              batch.scheduleId === "oneTime" ? "oneTime" : batch.scheduleId
            ],
          )}
          discarding={discarding}
          onDiscard={handleDiscard}
          onCommitted={(summary) => {
            setCommitSummary(summary);
            if (summary.failed.length === 0) setStep("done");
            router.refresh();
          }}
        />
      )}

      {step === "done" && commitSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" />
              Paper signups recorded
            </CardTitle>
            <CardDescription>
              The sheet has been committed to this project&apos;s attendance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm">
              <li>
                <strong>{commitSummary.created}</strong> new attendance records
                created
              </li>
              <li>
                <strong>{commitSummary.updated}</strong> existing signups marked
                attended
              </li>
              <li>
                <strong>{commitSummary.rosterOnly}</strong> roster-only entries
                (no email)
              </li>
              {commitSummary.overCapacity > 0 && (
                <li>
                  <strong>{commitSummary.overCapacity}</strong> recorded over
                  the slot capacity
                </li>
              )}
              {commitSummary.notificationsQueued > 0 && (
                <li>
                  <strong>{commitSummary.notificationsQueued}</strong>{" "}
                  attendance notifications queued
                </li>
              )}
              {commitSummary.certificatesIssued > 0 && (
                <li>
                  <strong>{commitSummary.certificatesIssued}</strong>{" "}
                  certificates issued (this session&apos;s hours were already
                  published)
                </li>
              )}
            </ul>
            {commitSummary.certificateErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  Attendance saved; certificates need attention
                </AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    Retry issuance now. If delivery still fails, use the Hours
                    page&apos;s certificate resend after confirming the
                    recipient addresses.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={retryingCertificates}
                      onClick={retryCertificates}
                    >
                      {retryingCertificates
                        ? "Retrying…"
                        : "Retry certificate issuance"}
                    </Button>
                    <Button asChild type="button" variant="outline">
                      <Link href={`/projects/${projectId}/hours`}>
                        Open Hours
                      </Link>
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {commitSummary.failed.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  {commitSummary.failed.length} row
                  {commitSummary.failed.length > 1 ? "s" : ""} could not be
                  recorded
                </AlertTitle>
                <AlertDescription>
                  {commitSummary.failed
                    .map((failure) =>
                      failure.detail === "slot_full"
                        ? "The slot is full. Return to review and approve the capacity override if appropriate."
                        : failure.detail,
                    )
                    .join(" · ")}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button asChild>
                <Link href={`/projects/${projectId}/hours`}>
                  Review &amp; publish hours
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setBatch(null);
                  setCommitSummary(null);
                  setStep("slot");
                }}
              >
                Scan another sheet
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
