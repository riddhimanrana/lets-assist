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

import { ScheduleSlotStep } from "./ScheduleSlotStep";
import { CaptureStep } from "./CaptureStep";
import { ReviewTable } from "./ReviewTable";
import { discardPaperScanBatch } from "./actions";

export interface PaperScanSlotOption {
  id: string;
  label: string;
  windowStartsAt: number;
  windowEndsAt: number;
}

export interface PaperScanBatchView {
  id: string;
  scheduleId: string;
  status: "draft" | "extracting" | "review";
  imageCount: number;
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
}

export interface CommitSummary {
  created: number;
  updated: number;
  rosterOnly: number;
  overCapacity: number;
  failed: Array<{ rowId: string; detail: string }>;
  certificatesIssued: number;
  emailsSent: number;
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
}: PaperSignupsClientProps) {
  const router = useRouter();

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    initialBatch?.scheduleId ?? null,
  );
  const [batch, setBatch] = useState<PaperScanBatchView | null>(initialBatch);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);

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
            Scan paper signups
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
            scan now — recorded times are clamped to the scheduled slot.
          </AlertDescription>
        </Alert>
      )}

      {step === "slot" && (
        <ScheduleSlotStep
          slotOptions={slotOptions}
          timezone={projectTimezone}
          selectedSlotId={selectedSlotId}
          onSelect={setSelectedSlotId}
          onContinue={() => selectedSlotId && setStep("capture")}
        />
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
            setStep("done");
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
              {commitSummary.emailsSent > 0 && (
                <li>
                  <strong>{commitSummary.emailsSent}</strong> volunteers emailed
                  a link to their record
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
                        ? "The slot is full — re-scan with the capacity override to include everyone."
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
