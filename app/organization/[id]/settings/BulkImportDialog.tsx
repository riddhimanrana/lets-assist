"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock3,
  Users,
  UserCog,
} from "lucide-react";
import { bulkInviteMembers } from "@/app/organization/[id]/admin/actions";
import { parseEmails } from "@/utils/email-parser";
import type { BulkInviteResponse } from "@/types/invitation";
import type {
  ContactImportCreateResponse,
  ContactImportParseSummary,
  ContactImportProcessResponse,
  ContactImportRole,
  OrganizationContactImportJob,
} from "@/types/contact-import";

interface BulkImportDialogProps {
  organizationId: string;
  onSuccess?: () => void;
}

type ImportMode = "file" | "manual";
type DialogStep = "input" | "preview" | "manualResult" | "importProcessing" | "importResult";

type FailedRowPreview = {
  row_number: number;
  email: string;
  error: string | null;
  status: "failed" | "skipped";
};

const IMPORT_BATCH_SIZE = 100;
const ROLE_OPTIONS = [
  { label: "Members", value: "member" },
  { label: "Staff", value: "staff" },
] as const;

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mergeFailedRows(
  previous: FailedRowPreview[],
  nextRows: FailedRowPreview[],
): FailedRowPreview[] {
  const mergedMap = new Map<string, FailedRowPreview>();

  for (const row of previous) {
    mergedMap.set(`${row.row_number}-${row.status}`, row);
  }

  for (const row of nextRows) {
    mergedMap.set(`${row.row_number}-${row.status}`, row);
  }

  return Array.from(mergedMap.values())
    .sort((a, b) => a.row_number - b.row_number)
    .slice(0, 50);
}

export default function BulkImportDialog({
  organizationId,
  onSuccess,
}: BulkImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("file");
  const [emailInput, setEmailInput] = useState("");
  const [role, setRole] = useState<ContactImportRole>("member");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseSummary, setParseSummary] = useState<ContactImportParseSummary | null>(null);
  const [invalidRowsPreview, setInvalidRowsPreview] = useState<
    ContactImportCreateResponse["invalidRowsPreview"]
  >([]);
  const [failedRowsPreview, setFailedRowsPreview] = useState<FailedRowPreview[]>([]);
  const [importJob, setImportJob] = useState<OrganizationContactImportJob | null>(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importStageMessage, setImportStageMessage] = useState("");

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

    return Math.min((importJob.processed_rows / importJob.valid_rows) * 100, 100);
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
    setSelectedFile(null);
    setUploadError(null);
    setParseSummary(null);
    setInvalidRowsPreview([]);
    setFailedRowsPreview([]);
    setImportJob(null);
    setIsProcessingImport(false);
    setImportStageMessage("");
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
      const loadingToast = toast.loading("Sending invitations...");

      const response = await bulkInviteMembers({
        organizationId,
        emails: parsedEmails,
        role,
      });

      setResult(response);
      setStep("manualResult");

      if (response.successful > 0 && onSuccess) {
        onSuccess();
      }

      if (response.successful > 0) {
        toast.success(`Sent ${response.successful}/${response.total} invitations.`, {
          id: loadingToast,
        });
      } else {
        toast.error("No invitations were sent.", {
          id: loadingToast,
          description: response.results[0]?.error || "Please review the row-level results.",
        });
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
        throw new Error(payload.error || "Failed to process contact import batch.");
      }

      latestJob = payload.job;
      setImportJob(payload.job);

      if (payload.failedRowsPreview?.length) {
        setFailedRowsPreview((previous) =>
          mergeFailedRows(previous, payload.failedRowsPreview as FailedRowPreview[]),
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

    if (!processingAbortRef.current && latestJob?.successful_invites && onSuccess) {
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
    setImportStageMessage("Uploading and parsing file...");

    const loadingToast = toast.loading("Uploading and parsing file...");

    try {
      const formData = new FormData();
      formData.set("organizationId", organizationId);
      formData.set("role", role);
      formData.set("file", selectedFile);

      const response = await fetch("/api/organization/import-jobs", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ContactImportCreateResponse;

      if (!response.ok || !payload.success || !payload.job) {
        if (payload.success && payload.mode === "direct" && payload.directResult) {
          setParseSummary(payload.parseSummary || null);
          setInvalidRowsPreview(payload.invalidRowsPreview || []);
          setResult(payload.directResult as BulkInviteResponse);
          setStep("manualResult");
          setImportJob(null);

          if (payload.directResult.successful > 0 && onSuccess) {
            onSuccess();
          }

          toast.success(
            `Import complete: ${payload.directResult.successful}/${payload.directResult.total} invitations sent.`,
            {
              id: loadingToast,
            },
          );

          return;
        }

        throw new Error(payload.error || "Failed to process contact import.");
      }

      setImportStageMessage("Processing invitations...");
      setStep("importProcessing");
      setImportJob(payload.job);
      setParseSummary(payload.parseSummary || null);
      setInvalidRowsPreview(payload.invalidRowsPreview || []);

      if (
        payload.job.status === "failed" ||
        payload.job.status === "completed" ||
        payload.job.valid_rows === 0
      ) {
        setStep("importResult");
        toast.success("Import finished.", { id: loadingToast });
        return;
      }

      await processImportJobUntilDone(payload.job.id);
      setStep("importResult");
      toast.success("Import finished.", { id: loadingToast });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error starting contact import.";
      setUploadError(message);
      setStep("input");
      toast.error("Import failed.", {
        id: loadingToast,
        description: message,
      });
    } finally {
      setIsProcessingImport(false);
      setImportStageMessage("");
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
            <Upload className="mr-2 h-4 w-4" />
            Bulk Import
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        {step === "input" && (
          <>
            <DialogHeader>
              <DialogTitle>Bulk Import Members</DialogTitle>
              <DialogDescription>
                Upload CSV/Excel files or paste copied member lists. The parser will infer the email column automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 ">
              <div className="space-y-2">
                <Label htmlFor="role">Invite as</Label>
                <Select
                  items={ROLE_OPTIONS}
                  value={role}
                  onValueChange={(v) => setRole(v as ContactImportRole)}
                >
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Invite as" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span>Members</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="staff">
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4" />
                        <span>Staff</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {role === "staff"
                    ? "Staff can verify hours and help manage the organization."
                    : "Members can participate in volunteer opportunities."}
                </p>
              </div>

              <Tabs value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
                <TabsList className="w-full">
                  <TabsTrigger value="file" className="w-full">File Upload</TabsTrigger>
                  <TabsTrigger value="manual" className="w-full">Paste Emails</TabsTrigger>
                </TabsList>

                <TabsContent value="file" className="space-y-4">
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <Label htmlFor="import-file">CSV / Excel file</Label>
                    <input
                      id="import-file"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setSelectedFile(file);
                        setUploadError(null);
                      }}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium"
                    />
                    <p className="text-xs text-muted-foreground">
                      We support CSV, XLSX, and XLS. Use one contact per row.
                    </p>
                  </div>

                  {selectedFile && (
                    <Alert>
                      <FileSpreadsheet className="h-4 w-4" />
                      <AlertTitle>{selectedFile.name}</AlertTitle>
                      <AlertDescription>
                        {formatFileSize(selectedFile.size)} · ready to import.
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>

                <TabsContent value="manual" className="space-y-4">
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <Label htmlFor="emails">Email Addresses</Label>
                    <Textarea
                      id="emails"
                      placeholder="Enter email addresses separated by commas, semicolons, or new lines:

john@example.com
jane@example.com
bob@example.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="min-h-40 font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Supports copied text, CSV-style rows, and Name &lt;email&gt; format.
                    </p>
                  </div>

                  {emailInput.trim() && (
                    <Alert variant={hasValidEmails ? "default" : "destructive"}>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>
                        {hasValidEmails
                          ? `${parsedEmails.length} valid email${parsedEmails.length !== 1 ? "s" : ""} found`
                          : "No valid emails found"}
                      </AlertTitle>
                      <AlertDescription>
                        {hasValidEmails
                          ? "Click Preview to review before sending invitations."
                          : "Please enter valid email addresses."}
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>
              </Tabs>

              {uploadError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Import error</AlertTitle>
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              {mode === "manual" ? (
                <Button onClick={handlePreview} disabled={!hasValidEmails}>
                  Preview
                </Button>
              ) : (
                <Button onClick={handleStartFileImport} disabled={!selectedFile || isProcessingImport}>
                  {isProcessingImport ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {importStageMessage || "Starting import..."}
                    </>
                  ) : (
                    "Start Import"
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>Review Invitations</DialogTitle>
              <DialogDescription>
                {parsedEmails.length} people will be invited as{" "}
                <Badge variant={role === "staff" ? "default" : "secondary"} className="capitalize">
                  {role}
                </Badge>
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-75 pr-4">
              <div className="space-y-2 py-4">
                {parsedEmails.map((email, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border bg-card px-3 py-2"
                  >
                    <span className="truncate text-sm font-medium">{email}</span>
                    <Badge variant="secondary" className="text-xs">
                      Pending
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={handleBack} disabled={isPending}>
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Invitations...
                  </>
                ) : (
                  `Send ${parsedEmails.length} Invitation${parsedEmails.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "manualResult" && result && (
          <>
            <DialogHeader>
              <DialogTitle>
                {result.successful === result.total
                  ? "All Invitations Sent!"
                  : result.successful > 0
                  ? "Invitations Partially Sent"
                  : "Failed to Send Invitations"}
              </DialogTitle>
              <DialogDescription>
                {result.successful} of {result.total} invitation
                {result.total !== 1 ? "s" : ""} sent successfully.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 py-2">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Sent</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-lg font-semibold tabular-nums">{result.successful}</p>
                  <Badge variant="secondary">Success</Badge>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Failed</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-lg font-semibold tabular-nums">{result.failed}</p>
                  <Badge variant={result.failed > 0 ? "destructive" : "outline"}>
                    {result.failed > 0 ? "Needs attention" : "None"}
                  </Badge>
                </div>
              </div>
            </div>

            <ScrollArea className="max-h-75 pr-4">
              <div className="space-y-2 py-4">
                {result.results.map((item, index) => (
                  <div
                    key={index}
                    className="rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {item.success ? (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span className="truncate text-sm font-medium">{item.email}</span>
                        </div>
                        {item.error && (
                          <p className="mt-2 text-xs text-destructive">{item.error}</p>
                        )}
                      </div>
                      <Badge variant={item.success ? "secondary" : "destructive"}>
                        {item.success ? "Sent" : "Failed"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}

        {step === "importProcessing" && importJob && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock3 className="h-5 w-5" />
                Processing Import Job
              </DialogTitle>
              <DialogDescription>
                Processing invitations and tracking progress in real time.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {parseSummary && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-muted-foreground">Valid rows</p>
                    <p className="text-sm font-semibold">{parseSummary.validRows}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-muted-foreground">Invalid rows</p>
                    <p className="text-sm font-semibold">{parseSummary.invalidRows}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-muted-foreground">Duplicate rows</p>
                    <p className="text-sm font-semibold">{parseSummary.duplicateRows}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-muted-foreground">Skipped empty rows</p>
                    <p className="text-sm font-semibold">{parseSummary.skippedEmptyRows}</p>
                  </div>
                </div>
              )}

              <Progress value={progressPercent}>
                <div className="flex w-full items-center">
                  <ProgressLabel>Processed valid contacts</ProgressLabel>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {importJob.processed_rows}/{Math.max(importJob.valid_rows, 0)}
                  </span>
                </div>
              </Progress>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isProcessingImport ? "Processing next batch..." : "Finalizing results..."}
              </div>
            </div>
          </>
        )}

        {step === "importResult" && importJob && (
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
                {importJob.successful_invites !== 1 ? "s" : ""} sent out of {importJob.valid_rows} valid contact
                {importJob.valid_rows !== 1 ? "s" : ""}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-muted-foreground">Successful invites</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-lg font-semibold tabular-nums">{importJob.successful_invites}</p>
                    <Badge variant="secondary">Sent</Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-muted-foreground">Failed / skipped</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-lg font-semibold tabular-nums">{importJob.failed_invites}</p>
                    <Badge variant={importJob.failed_invites > 0 ? "destructive" : "outline"}>
                      {importJob.failed_invites > 0 ? "Review" : "None"}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-muted-foreground">Processed rows</p>
                  <p className="text-sm font-semibold">{importJob.processed_rows}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-muted-foreground">Job status</p>
                  <Badge variant={importJob.status === "completed" ? "default" : "secondary"} className="capitalize">
                    {importJob.status}
                  </Badge>
                </div>
              </div>

              {(invalidRowsPreview?.length || failedRowsPreview.length) ? (
                <ScrollArea className="max-h-64 pr-4 border rounded-md">
                  <div className="space-y-4 p-3">
                    {invalidRowsPreview && invalidRowsPreview.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Invalid rows (parse stage)
                        </p>
                        {invalidRowsPreview.map((row) => (
                          <div
                            key={`invalid-${row.rowNumber}-${row.reason}`}
                            className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <XCircle className="h-4 w-4 text-destructive" />
                                  <span className="text-xs font-medium">
                                    Row {row.rowNumber}: {row.email || "(empty email)"}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-destructive">{row.reason}</p>
                              </div>
                              <Badge variant="destructive">Invalid</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {failedRowsPreview.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Failed or skipped rows (delivery stage)
                        </p>
                        {failedRowsPreview.map((row) => (
                          <div
                            key={`failed-${row.row_number}-${row.status}-${row.email}`}
                            className="rounded-lg border bg-muted/30 p-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {row.status === "failed" ? (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span className="text-xs font-medium">
                                    Row {row.row_number}: {row.email || "(empty email)"}
                                  </span>
                                </div>
                                <p className={`mt-1 text-[11px] ${row.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                                  {row.error || row.status}
                                </p>
                              </div>
                              <Badge variant={row.status === "failed" ? "destructive" : "secondary"} className="capitalize">
                                {row.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>No row-level issues</AlertTitle>
                  <AlertDescription>
                    All valid contacts in this batch were invited successfully.
                  </AlertDescription>
                </Alert>
              )}

              {importJob.last_error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Latest job error</AlertTitle>
                  <AlertDescription>{importJob.last_error}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
