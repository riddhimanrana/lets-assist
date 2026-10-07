"use client";

import { AlertCircle, Check, FileCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  CsvVerificationProgress,
  CsvVerificationRecordList,
  CsvVerificationSummaryBlock,
} from "./CsvVerificationResultsStep";
import { CsvVerificationUploadStep } from "./CsvVerificationUploadStep";
import type { CsvVerificationStep } from "./csv-verification-types";
import { useCsvVerification } from "./useCsvVerification";

interface CsvVerificationModalProps {
  children?: React.ReactElement;
}

const STEPS: Array<{ id: CsvVerificationStep; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "verify", label: "Verify" },
  { id: "results", label: "Results" },
];

function StepIndicator({ current }: { current: CsvVerificationStep }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isDone = index < currentIndex;

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                isCurrent &&
                  "border-primary bg-primary text-primary-foreground",
                isDone && "bg-muted",
                !isCurrent && !isDone && "text-muted-foreground",
              )}
            >
              {isDone ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                isCurrent
                  ? "font-medium"
                  : "text-muted-foreground sr-only sm:not-sr-only",
              )}
            >
              {step.label}
              {isDone ? <span className="sr-only"> (done)</span> : null}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="bg-border h-px w-6 sm:w-10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function CsvVerificationModal({ children }: CsvVerificationModalProps) {
  const {
    isOpen,
    setIsOpen,
    file,
    results,
    summary,
    error,
    isBusy,
    verificationProgress,
    step,
    handleFileChange,
    processAndVerifyCsv,
    resetModal,
  } = useCsvVerification();

  const startOver = () => {
    resetModal();
    toast.success("Reset complete", {
      description: "Form has been reset. You can now upload a new CSV file.",
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          resetModal(); // Reset immediately when closing
        }
      }}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  children || (
                    <Button variant="outline" size="sm">
                      <FileCheck data-icon="inline-start" aria-hidden="true" />
                      Verify certificates
                    </Button>
                  )
                }
              />
            }
          />
          <TooltipContent>
            <p>
              Upload a CSV file to verify certificate data format and validity
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 gap-4 border-b px-4 py-4 sm:px-6">
          <div className="grid gap-2 pr-8">
            <DialogTitle>Certificate CSV verification</DialogTitle>
            <DialogDescription>
              Upload a CSV file, verify its format, and check certificates
              against our database.
            </DialogDescription>
          </div>
          <StepIndicator current={step} />
        </DialogHeader>

        <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-4 py-6 sm:px-6">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription className="break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          {step === "upload" ? (
            <CsvVerificationUploadStep
              file={file}
              disabled={isBusy}
              onFileChange={handleFileChange}
              onRemove={resetModal}
            />
          ) : null}

          {step === "verify" ? (
            <CsvVerificationProgress progress={verificationProgress} />
          ) : null}

          {step === "results" && summary ? (
            <CsvVerificationSummaryBlock summary={summary} />
          ) : null}

          {step !== "upload" && results.length > 0 ? (
            <CsvVerificationRecordList results={results} />
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-4 sm:items-center sm:justify-between sm:px-6">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {results.length > 0 ? (
              <>
                {results.length} certificate{results.length !== 1 ? "s" : ""}{" "}
                processed
                {summary?.totalHours
                  ? `, ${summary.totalHours} total hours`
                  : ""}
              </>
            ) : null}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {step === "results" ? (
              <>
                <Button variant="outline" onClick={startOver}>
                  Reset
                </Button>
                <Button onClick={() => setIsOpen(false)}>
                  {summary?.totalHours ? "Done" : "Close"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Close
                </Button>
                <Button
                  onClick={processAndVerifyCsv}
                  disabled={!file || isBusy}
                >
                  {isBusy ? (
                    <>
                      <Loader2
                        data-icon="inline-start"
                        aria-hidden="true"
                        className="animate-spin"
                      />
                      Verifying certificates ({verificationProgress}%)
                    </>
                  ) : (
                    "Verify certificates"
                  )}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
