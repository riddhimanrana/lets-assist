"use client";

import { Fragment, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { emailDataExport, getDataExportJobs } from "./actions";

type ExportJobStatus = "pending" | "processing" | "completed" | "failed";

type ExportJob = {
  id: string;
  status: ExportJobStatus;
  delivery_email: string;
  requested_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  error_message?: string | null;
  zip_size_bytes?: number | null;
  record_count?: number | null;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
};

const STATUS_BADGE: Record<
  ExportJobStatus,
  { label: string; variant: "info" | "warning" | "success" | "destructive" }
> = {
  pending: { label: "Pending", variant: "info" },
  processing: { label: "Processing", variant: "warning" },
  completed: { label: "Sent", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

export function DataExportSection() {
  const { user } = useAuth();
  const [isExportEmailing, setIsExportEmailing] = useState(false);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [isExportJobsLoading, setIsExportJobsLoading] = useState(true);

  // Poll for export jobs
  useEffect(() => {
    const fetchJobs = async () => {
      const result = await getDataExportJobs();
      if (result.success) {
        setExportJobs(result.jobs as ExportJob[]);
      }
      setIsExportJobsLoading(false);
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, []);

  const hasActiveExportRequest = exportJobs.some(
    (job) => job.status === "pending" || job.status === "processing",
  );

  const handleEmailDataExport = async () => {
    try {
      setIsExportEmailing(true);
      const result = await emailDataExport();

      if (!result.success) {
        toast.error(result.error || "Failed to send export email");
        return;
      }

      toast.success(
        result.email
          ? `Export queued. We'll email ${result.email} when it's ready.`
          : "Export queued. We'll email you when it's ready.",
      );

      const queuedJobId = result.jobId ?? `queued-${Date.now()}`;
      const queuedJob: ExportJob = {
        id: queuedJobId,
        status: "pending",
        delivery_email: result.email ?? user?.email ?? "",
        requested_at: result.requestedAt ?? new Date().toISOString(),
        started_at: null,
        completed_at: null,
        failed_at: null,
        error_message: null,
        zip_size_bytes: null,
        record_count: null,
        signed_url: null,
        signed_url_expires_at: null,
      };

      setExportJobs((previousJobs) => {
        const dedupedJobs = previousJobs.filter(
          (job) => job.id !== queuedJobId,
        );
        return [queuedJob, ...dedupedJobs].slice(0, 5);
      });
      setIsExportJobsLoading(false);

      const refreshedJobs = await getDataExportJobs();
      if (refreshedJobs.success) {
        setExportJobs(refreshedJobs.jobs as ExportJob[]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to email data export",
      );
    } finally {
      setIsExportEmailing(false);
    }
  };

  return (
    <SettingsSection
      title="Export your data"
      description="Get a ZIP of your profile, hours and certificates, notifications, and account history. We email it to you within 24 hours."
      footerHint={
        hasActiveExportRequest
          ? "Your export is already queued. No need to refresh this page."
          : "Large exports arrive as a secure download link."
      }
      footer={
        <Button
          type="button"
          variant="outline"
          onClick={handleEmailDataExport}
          disabled={isExportEmailing || hasActiveExportRequest}
        >
          <Mail data-icon="inline-start" />
          {isExportEmailing
            ? "Queueing export..."
            : hasActiveExportRequest
              ? "Export already queued"
              : "Request export"}
        </Button>
      }
    >
      {isExportJobsLoading ? (
        <div className="grid gap-2" aria-busy="true">
          <span className="sr-only">Loading export history...</span>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      ) : exportJobs.length > 0 ? (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Recent requests</h3>
          <ItemGroup className="gap-0">
            {exportJobs.map((job, index) => {
              const badge = STATUS_BADGE[job.status];

              return (
                <Fragment key={job.id}>
                  {index > 0 && <ItemSeparator className="my-0" />}
                  <Item className="px-0">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="line-clamp-none flex-wrap">
                        {new Date(job.requested_at).toLocaleString()}
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : null}
                      </ItemTitle>
                      <ItemDescription className="break-all">
                        To: {job.delivery_email}
                        {job.zip_size_bytes
                          ? ` • ${(job.zip_size_bytes / 1024 / 1024).toFixed(2)} MB`
                          : null}
                      </ItemDescription>
                      {job.status === "failed" && job.error_message && (
                        <p
                          className="text-destructive line-clamp-2 text-sm"
                          title={job.error_message}
                        >
                          {job.error_message}
                        </p>
                      )}
                    </ItemContent>
                    {job.status === "completed" && job.signed_url && (
                      <ItemActions>
                        <Button variant="outline" asChild>
                          <a
                            href={job.signed_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Download
                          </a>
                        </Button>
                      </ItemActions>
                    )}
                  </Item>
                </Fragment>
              );
            })}
          </ItemGroup>
        </div>
      ) : null}
    </SettingsSection>
  );
}
