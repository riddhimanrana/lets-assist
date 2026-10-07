"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { bulkInviteMembers } from "@/app/organization/[id]/admin/actions";
import { parseEmails } from "@/utils/email-parser";
import type { BulkInviteResponse } from "@/types/invitation";
import type { InvitationDuration } from "@/lib/organization/invitation-utils";
import type {
  ContactImportCreateResponse,
  ContactImportParseSummary,
  ContactImportProcessResponse,
  ContactImportRole,
  OrganizationContactImportJob,
} from "@/types/contact-import";

import {
  IMPORT_BATCH_SIZE,
  mergeFailedRows,
  type DialogStep,
  type FailedRowPreview,
  type ImportMode,
} from "./bulk-import-shared";
import BulkImportInputStep from "./BulkImportInputStep";
import {
  BulkImportJobResultStep,
  BulkImportManualResultStep,
  BulkImportPreviewStep,
  BulkImportProcessingStep,
} from "./BulkImportResultSteps";

interface BulkImportDialogProps {
  organizationId: string;
  onSuccess?: () => void;
}

export default function BulkImportDialog({
  organizationId,
  onSuccess,
}: BulkImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("file");
  const [emailInput, setEmailInput] = useState("");
  const [role, setRole] = useState<ContactImportRole>("member");
  const [invitationDuration, setInvitationDuration] =
    useState<InvitationDuration>("1_month");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseSummary, setParseSummary] =
    useState<ContactImportParseSummary | null>(null);
  const [invalidRowsPreview, setInvalidRowsPreview] = useState<
    ContactImportCreateResponse["invalidRowsPreview"]
  >([]);
  const [failedRowsPreview, setFailedRowsPreview] = useState<
    FailedRowPreview[]
  >([]);
  const [importJob, setImportJob] =
    useState<OrganizationContactImportJob | null>(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkInviteResponse | null>(null);
  const [step, setStep] = useState<DialogStep>("input");
  const processingAbortRef = useRef(false);

  // Parse and validate emails for preview
  const parsedEmails = useMemo(() => parseEmails(emailInput), [emailInput]);
  const hasValidEmails = parsedEmails.length > 0;

  const progressPercent = useMemo(() => {
    if (!importJob || importJob.valid_rows <= 0) {
      return 0;
    }

    return Math.min(
      (importJob.processed_rows / importJob.valid_rows) * 100,
      100,
    );
  }, [importJob]);

  useEffect(() => {
    if (!open) {
      processingAbortRef.current = true;
    }
  }, [open]);

  const resetDialog = () => {
    processingAbortRef.current = true;
    setMode("file");
    setEmailInput("");
    setRole("member");
    setInvitationDuration("1_week");
    setSelectedFile(null);
    setUploadError(null);
    setParseSummary(null);
    setInvalidRowsPreview([]);
    setFailedRowsPreview([]);
    setImportJob(null);
    setIsProcessingImport(false);
    setResult(null);
    setStep("input");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);

    if (newOpen) {
      processingAbortRef.current = false;
    }

    if (!newOpen) {
      // Delay reset to allow dialog close animation
      setTimeout(resetDialog, 150);
    }
  };

  const handlePreview = () => {
    if (hasValidEmails) {
      setStep("preview");
    }
  };

  const handleBack = () => {
    setStep("input");
  };

  const handleSubmit = () => {
    startTransition(async () => {
      const response = await bulkInviteMembers({
        organizationId,
        emails: parsedEmails,
        role,
        invitationDuration,
      });

      setResult(response);
      setStep("manualResult");

      if (response.successful > 0 && onSuccess) {
        onSuccess();
      }
    });
  };

  const processImportJobUntilDone = async (jobId: string) => {
    let latestJob: OrganizationContactImportJob | null = null;

    while (!processingAbortRef.current) {
      const response = await fetch(
        `/api/organization/import-jobs/${jobId}/process`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ batchSize: IMPORT_BATCH_SIZE }),
        },
      );

      const payload = (await response.json()) as ContactImportProcessResponse;

      if (!response.ok || !payload.success || !payload.job) {
        throw new Error(
          payload.error || "Failed to process contact import batch.",
        );
      }

      latestJob = payload.job;
      setImportJob(payload.job);

      if (payload.failedRowsPreview?.length) {
        setFailedRowsPreview((previous) =>
          mergeFailedRows(
            previous,
            payload.failedRowsPreview as FailedRowPreview[],
          ),
        );
      }

      if (
        payload.job.status === "completed" ||
        payload.job.status === "failed" ||
        payload.job.status === "cancelled"
      ) {
        break;
      }
    }

    if (
      !processingAbortRef.current &&
      latestJob?.successful_invites &&
      onSuccess
    ) {
      onSuccess();
    }
  };

  const handleStartFileImport = async () => {
    if (!selectedFile) {
      setUploadError("Please choose a CSV or Excel file to import.");
      return;
    }

    setUploadError(null);
    setResult(null);
    setParseSummary(null);
    setInvalidRowsPreview([]);
    setFailedRowsPreview([]);
    setImportJob(null);
    setIsProcessingImport(true);
    setStep("importProcessing");

    try {
      const formData = new FormData();
      formData.set("organizationId", organizationId);
      formData.set("role", role);
      formData.set("invitationDuration", invitationDuration);
      formData.set("file", selectedFile);

      const response = await fetch("/api/organization/import-jobs", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ContactImportCreateResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to start contact import.");
      }

      if (payload.mode === "direct") {
        const directResult = payload.directResult || {
          total: 0,
          successful: 0,
          failed: 0,
          results: [],
        };

        setResult(directResult);
        setParseSummary(payload.parseSummary || null);
        setInvalidRowsPreview(payload.invalidRowsPreview || []);
        setStep("manualResult");

        if (directResult.successful > 0 && onSuccess) {
          onSuccess();
        }

        return;
      }

      if (!payload.job) {
        throw new Error("Import started but no job details were returned.");
      }

      setImportJob(payload.job);
      setParseSummary(payload.parseSummary || null);
      setInvalidRowsPreview(payload.invalidRowsPreview || []);

      if (
        payload.job.status === "failed" ||
        payload.job.status === "completed" ||
        payload.job.valid_rows === 0
      ) {
        setStep("importResult");
        return;
      }

      await processImportJobUntilDone(payload.job.id);
      setStep("importResult");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected error starting contact import.";
      setUploadError(message);
      setStep("input");
    } finally {
      setIsProcessingImport(false);
    }
  };

  const handleDone = () => {
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button>
            <Upload />
            Import members
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        {step === "input" && (
          <BulkImportInputStep
            mode={mode}
            role={role}
            invitationDuration={invitationDuration}
            emailInput={emailInput}
            validEmailCount={parsedEmails.length}
            selectedFile={selectedFile}
            uploadError={uploadError}
            isProcessingImport={isProcessingImport}
            onModeChange={setMode}
            onRoleChange={setRole}
            onInvitationDurationChange={setInvitationDuration}
            onEmailInputChange={setEmailInput}
            onFileChange={(file) => {
              setSelectedFile(file);
              setUploadError(null);
            }}
            onCancel={() => handleOpenChange(false)}
            onPreview={handlePreview}
            onStartFileImport={handleStartFileImport}
          />
        )}

        {step === "preview" && (
          <BulkImportPreviewStep
            emails={parsedEmails}
            role={role}
            invitationDuration={invitationDuration}
            isPending={isPending}
            onBack={handleBack}
            onSubmit={handleSubmit}
          />
        )}

        {step === "manualResult" && result && (
          <BulkImportManualResultStep result={result} onDone={handleDone} />
        )}

        {step === "importProcessing" && !importJob && (
          <DialogHeader>
            <DialogTitle>Uploading file</DialogTitle>
            <DialogDescription>
              Reading your contacts. This can take a moment.
            </DialogDescription>
          </DialogHeader>
        )}

        {step === "importProcessing" && importJob && (
          <BulkImportProcessingStep
            importJob={importJob}
            parseSummary={parseSummary}
            progressPercent={progressPercent}
            isProcessingImport={isProcessingImport}
          />
        )}

        {step === "importResult" && importJob && (
          <BulkImportJobResultStep
            importJob={importJob}
            invalidRowsPreview={invalidRowsPreview}
            failedRowsPreview={failedRowsPreview}
            onDone={handleDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
