import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportJobPresentation, type ExportJob } from "./data-export-state";

export function DataExportJobDetails({
  job,
  now,
  downloading,
  onDownloadAction,
}: {
  job: ExportJob;
  now: number;
  downloading: boolean;
  onDownloadAction: (job: ExportJob) => void;
}) {
  const state = exportJobPresentation(job, now);
  const requested = Number.isFinite(Date.parse(job.requested_at))
    ? new Date(job.requested_at).toLocaleString()
    : "Unknown request date";
  return (
    <li className="rounded-lg border p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Requested {requested}</p>
        <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
          {state.label}
        </span>
      </div>
      <p>{state.description}</p>
      <p className="text-muted-foreground break-words">
        {state.emailLabel}
        {job.delivery_email ? `: ${job.delivery_email}` : ""}
      </p>
      {state.emailWarning && (
        <p className="text-muted-foreground">{state.emailWarning}</p>
      )}
      {state.canDownload && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloading}
            aria-label={`Download export requested ${requested}`}
            onClick={() => onDownloadAction(job)}
          >
            <Download className="size-4" aria-hidden="true" />
            {downloading ? "Preparing download..." : "Download archive"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {job.zip_size_bytes !== null
              ? `${(job.zip_size_bytes / 1024 / 1024).toFixed(2)} MB`
              : ""}
            {job.record_count !== null
              ? ` · ${job.record_count.toLocaleString()} records`
              : ""}
          </span>
        </div>
      )}
    </li>
  );
}
