"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  emailDataExport,
  getDataExportDownload,
  getDataExportJobs,
} from "./actions";
import { DataExportJobDetails } from "./DataExportJobDetails";
import { createExportPoller } from "./data-export-poller";
import {
  exportJobSchema,
  exportJobPresentation,
  exportRequestMessage,
  mergeExportJob,
  validExportDownloadUrl,
  type ExportJob,
} from "./data-export-state";

const requestResultSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    job: exportJobSchema,
    existing: z.boolean(),
  }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

export default function DataExportSection() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(false);
  const poller = useRef<ReturnType<
    typeof createExportPoller<ExportJob[]>
  > | null>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = createExportPoller({
      read: async () => {
        const result = await getDataExportJobs();
        if (!result.success) throw new Error("Export history unavailable");
        return z.array(exportJobSchema).max(5).parse(result.jobs);
      },
      apply: (nextJobs: ExportJob[]) => {
        setJobs(nextJobs);
        setHistoryError(null);
        setLoading(false);
        setNow(Date.now());
        return nextJobs.some((job) => exportJobPresentation(job).shouldPoll);
      },
      onError: () => {
        setLoading(false);
        setHistoryError(
          "Export history could not be loaded. Refresh to try again.",
        );
      },
      visible: () => !document.hidden,
      schedule: (callback, milliseconds) =>
        window.setTimeout(callback, milliseconds),
      cancel: (handle) => window.clearTimeout(handle as number),
    });
    poller.current = controller;
    const visibilityChanged = () => {
      setNow(Date.now());
      controller.visibilityChanged();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    void controller.refresh();
    return () => {
      mounted.current = false;
      controller.stop();
      if (poller.current === controller) poller.current = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  useEffect(() => {
    const expiries = jobs
      .map((job) => Date.parse(job.artifact_expires_at ?? ""))
      .filter((expiry) => Number.isFinite(expiry) && expiry > now);
    if (expiries.length === 0) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.min(...expiries) - now + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [jobs, now]);

  const requestExport = async () => {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = requestResultSchema.safeParse(await emailDataExport());
      if (!mounted.current) return;
      if (!parsed.success)
        throw new Error(
          "Export request could not be confirmed. Refresh the status before trying again.",
        );
      const result = parsed.data;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJobs((previous) => mergeExportJob(previous, result.job));
      setLoading(false);
      setNow(Date.now());
      setNotice(exportRequestMessage(result.existing));
      poller.current?.invalidate();
    } catch {
      if (mounted.current) {
        setError(
          "Export request could not be confirmed. Refresh the status before trying again.",
        );
        poller.current?.invalidate();
      }
    } finally {
      if (mounted.current) setRequesting(false);
    }
  };

  const downloadExport = async (job: ExportJob) => {
    if (downloadingId !== null) return;
    if (!exportJobPresentation(job).canDownload) {
      setNow(Date.now());
      setError(
        "This archive is no longer available. Refresh its status or request a new export.",
      );
      poller.current?.invalidate();
      return;
    }
    setDownloadingId(job.id);
    setError(null);
    try {
      const result = await getDataExportDownload(job.id);
      if (!mounted.current) return;
      if (!result.success) {
        setError(result.error);
        poller.current?.invalidate();
        return;
      }
      if (!result.url || !validExportDownloadUrl(result.url))
        throw new Error("Invalid download location");
      // The URL is not saved in component state or browser storage.
      window.location.assign(result.url);
    } catch {
      if (mounted.current)
        setError(
          "Download could not be started. Refresh the status and try again.",
        );
    } finally {
      if (mounted.current) setDownloadingId(null);
    }
  };

  const active = jobs.some((job) => exportJobPresentation(job, now).active);
  return (
    <SettingsSection
      title="Export your data"
      description="Request a ZIP archive of your account records. Download it here when it is ready."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Includes account records and CSF/DV records linked to your account.
          Files are listed with their details; file contents are not included.
          Credentials, staff evidence, and source spreadsheets are excluded. The
          archive&apos;s manifest lists its scope.
        </p>
        {historyError && (
          <p role="alert" className="text-sm text-destructive">
            {historyError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading export history...
          </p>
        ) : jobs.length === 0 ? (
          !historyError && (
            <p className="text-sm text-muted-foreground">
              No export requests yet.
            </p>
          )
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Recent export requests</h3>
            <ul className="space-y-3" aria-live="polite">
              {jobs.map((job) => (
                <DataExportJobDetails
                  key={job.id}
                  job={job}
                  now={now}
                  downloading={downloadingId !== null}
                  onDownloadAction={downloadExport}
                />
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={requestExport}
            disabled={loading || requesting || active}
          >
            {requesting
              ? "Requesting export..."
              : active
                ? "Export already queued"
                : "Request data archive"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError(null);
              void poller.current?.refresh();
            }}
          >
            Refresh status
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Requests are limited to one every 24 hours. Archive readiness and
          email notification status are shown separately.
        </p>
      </div>
    </SettingsSection>
  );
}
