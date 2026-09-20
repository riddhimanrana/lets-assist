"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  nextPaperCommitAttempt,
  type PaperCommitAttempt,
} from "@/lib/projects/paper-signup/commit-attempt";
import { inspectAttendanceIntervals } from "@/lib/projects/paper-signup/intervals";
import {
  hasPersistedAttendance,
  isAttendanceRowReady,
  isFinalAttendanceRow,
  isSavedAttendanceRow,
} from "@/lib/projects/paper-signup/review-state";
import { ReviewRowEditor } from "./ReviewRowEditor";
import {
  commitPaperScanBatch,
  getPaperScanImageUrls,
  updatePaperScanRow,
} from "./actions";
import {
  addAttendanceReviewRow,
  combineAttendanceReviewRows,
  loadAttendanceReview,
} from "./manual-actions";
import type {
  CommitSummary,
  PaperScanBatchView,
  PaperScanRowView,
} from "./PaperSignupsClient";

interface Props {
  projectId: string;
  batch: PaperScanBatchView;
  initialRows: PaperScanRowView[];
  timezone: string;
  window: { startsAt: number; endsAt: number } | null;
  sessionPublished: boolean;
  discarding: boolean;
  onDiscard: () => void;
  onCommitted: (summary: CommitSummary) => void;
}

export function ReviewTable({
  projectId,
  batch,
  initialRows,
  timezone,
  window,
  sessionPublished,
  discarding,
  onDiscard,
  onCommitted,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [editing, setEditing] = useState<PaperScanRowView | null>(null);
  const [images, setImages] = useState<
    Array<{ imageId: string; sequence: number; url: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [allowOverCapacity, setAllowOverCapacity] = useState(false);
  const commitAttempt = useRef<PaperCommitAttempt | null>(null);
  const [addKey, setAddKey] = useState(() => crypto.randomUUID());
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [targetId, setTargetId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [combineConfirmed, setCombineConfirmed] = useState(false);
  const [combineKey, setCombineKey] = useState(() => crypto.randomUUID());
  const reload = async () => {
    const result = await loadAttendanceReview({ projectId, batchId: batch.id });
    if ("error" in result) {
      toast.error(result.error);
      return null;
    }
    setRows(result.rows ?? []);
    return result.rows;
  };
  useEffect(() => {
    let current = true;
    void loadAttendanceReview({ projectId, batchId: batch.id }).then(
      (result) => {
        if (current && "rows" in result) setRows(result.rows ?? []);
      },
    );
    void getPaperScanImageUrls({ projectId, batchId: batch.id }).then(
      (result) => {
        if (current && "urls" in result) setImages(result.urls);
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, batch.id]);
  const unfinished = rows.filter((row) => !hasPersistedAttendance(row));
  const ready = useMemo(
    () => rows.filter((row) => isAttendanceRowReady(row, window)),
    [rows, window],
  );
  const add = async () => {
    setBusy(true);
    try {
      const result = await addAttendanceReviewRow({
        projectId,
        batchId: batch.id,
        requestId: addKey,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAddKey(crypto.randomUUID());
      const next = await reload();
      setEditing(next?.find((row) => row.id === result.rowId) ?? null);
    } finally {
      setBusy(false);
    }
  };
  const include = async (row: PaperScanRowView, checked: boolean) => {
    if (hasPersistedAttendance(row)) return;
    setBusy(true);
    try {
      const result = await updatePaperScanRow({
        projectId,
        batchId: batch.id,
        rowId: row.id,
        patch: {
          decision: checked ? "include" : "exclude",
          expectedRevision: row.reviewRevision,
        },
      });
      if ("error" in result) toast.error(result.error);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const attempt = nextPaperCommitAttempt(commitAttempt.current, {
        projectId,
        batchId: batch.id,
        rows: ready,
        allowOverCapacity,
      });
      commitAttempt.current = attempt;
      const result = await commitPaperScanBatch({
        projectId,
        batchId: batch.id,
        rowIds: attempt.rowIds,
        allowOverCapacity,
        idempotencyKey: attempt.key,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSummary(result);
      commitAttempt.current = null;
      const next = await reload();
      if (
        next &&
        next.every(
          (row) => isFinalAttendanceRow(row) || row.decision === "exclude",
        ) &&
        result.failed.length === 0
      )
        onCommitted(result);
    } catch {
      toast.error(
        "We couldn't confirm whether attendance was saved. Refresh saved review before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const combine = async () => {
    if (!combineConfirmed || !targetId || !sourceId || sourceId === targetId)
      return;
    setBusy(true);
    try {
      const result = await combineAttendanceReviewRows({
        projectId,
        batchId: batch.id,
        targetRowId: targetId,
        sourceRowIds: [sourceId],
        requestId: combineKey,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCombineKey(crypto.randomUUID());
      setSourceId("");
      setCombineConfirmed(false);
      const next = await reload();
      setEditing(next?.find((row) => row.id === targetId) ?? null);
    } finally {
      setBusy(false);
    }
  };
  const time = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-US", {
          timeZone: timezone,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Missing time";
  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={add}
          disabled={busy || rows.length >= 300}
        >
          Add missed row or walk-in
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void reload()}>
          Refresh saved review
        </Button>
      </div>
      {images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto rounded border p-3">
          {images.map((image) => (
            <a
              key={image.imageId}
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="w-40 shrink-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Source sheet page ${image.sequence + 1}`}
                className="h-28 w-full rounded border object-contain"
              />
              <span className="text-sm underline">
                Sheet page {image.sequence + 1}
              </span>
            </a>
          ))}
        </div>
      )}
      {sessionPublished && (
        <p className="rounded border p-3 text-sm">
          This session's hours are published. New reviewed attendees receive
          certificates when saved. Use the Hours correction action to change an
          existing award.
        </p>
      )}
      {summary && (
        <div role="status" className="rounded border p-3 text-sm">
          <p>
            {summary.created + summary.updated} attendance records saved;{" "}
            {summary.rosterOnly} uncredited roster entries saved;{" "}
            {summary.certificatesIssued} certificates available.
          </p>
          <p>
            {summary.notificationsQueued} notifications queued. Queued does not
            mean delivered.
          </p>
          {!!summary.reconciled && (
            <p>
              {summary.reconciled} saved roster entries matched to existing
              attendance. No additional hours awarded.
            </p>
          )}
          {summary.failed.map((failure) => (
            <p key={failure.rowId} className="text-destructive">
              Row {rows.find((row) => row.id === failure.rowId)?.sheetRowNumber}
              : {failure.detail.replaceAll("_", " ")}
            </p>
          ))}
          {summary.certificateErrors.map((error) => (
            <p key={error} className="text-destructive">
              {error}
            </p>
          ))}
        </div>
      )}
      {rows.length === 0 && (
        <p className="rounded border p-6 text-muted-foreground">
          No attendance rows yet. Add a volunteer manually, or scan a completed
          sheet.
        </p>
      )}
      <div className="space-y-3">
        {rows.map((row) => {
          const inspection = inspectAttendanceIntervals(
            row.attendanceIntervals,
            window,
          );
          return (
            <article key={row.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">
                    Row {row.sheetRowNumber}: {row.name || "Name needs review"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {row.email ||
                      (row.matchSignupId
                        ? "Existing signup selected"
                        : "No email: uncredited roster entry")}
                  </p>
                </div>
                <Badge
                  variant={isSavedAttendanceRow(row) ? "secondary" : "outline"}
                >
                  {row.outcome === "roster_only"
                    ? "Saved without credit"
                    : row.outcomeDetail === "reconciled_existing_attendance"
                      ? "Already recorded"
                      : isFinalAttendanceRow(row)
                        ? "Saved"
                        : row.reviewAcknowledged && row.identityConfirmed
                          ? "Reviewed"
                          : "Needs review"}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                {row.attendanceIntervals.map((interval, index) => (
                  <p key={index}>
                    Visit {index + 1}: {time(interval.checkIn)} to{" "}
                    {time(interval.checkOut)}
                  </p>
                ))}
                {inspection.minutes !== null && (
                  <p className="font-medium">
                    {Math.floor(inspection.minutes / 60)}h{" "}
                    {inspection.minutes % 60}m, excluding breaks
                  </p>
                )}
              </div>
              {!isFinalAttendanceRow(row) && (
                <div className="space-y-1 text-sm">
                  {inspection.problems.map((problem) => (
                    <p className="text-destructive" key={problem}>
                      {problem}
                    </p>
                  ))}
                  {inspection.outsideSession && (
                    <p>
                      Outside scheduled session
                      {row.timeExceptionReason
                        ? `: ${row.timeExceptionReason}`
                        : ". Add a reviewed reason."}
                    </p>
                  )}
                  {row.matchKind !== "none" && (
                    <p>
                      Suggested match:{" "}
                      {row.matchReasons.join(", ").replaceAll("_", " ")}.
                      Confirm identity in review.
                    </p>
                  )}
                  {Object.values(row.fieldConfidence).some(
                    (confidence) => confidence > 0 && confidence < 0.7,
                  ) && (
                    <p>
                      Some writing has low confidence. Compare it with the
                      source photo.
                    </p>
                  )}
                  {row.outcomeDetail && (
                    <p className="text-destructive">
                      {row.outcomeDetail.replaceAll("_", " ")}
                    </p>
                  )}
                </div>
              )}
              {!isFinalAttendanceRow(row) && (
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.decision === "include"}
                      disabled={busy || hasPersistedAttendance(row)}
                      onChange={(e) => void include(row, e.target.checked)}
                    />
                    {hasPersistedAttendance(row)
                      ? "Saved attendance stays included"
                      : "Include when reviewed"}
                  </label>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEditing(row)}
                  >
                    Review row {row.sheetRowNumber}
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {unfinished.length > 1 && (
        <details className="rounded border p-3">
          <summary className="cursor-pointer font-medium">
            Combine repeated visits or separate sign-in/out rows
          </summary>
          <div className="mt-3 space-y-3 text-sm">
            <p>
              Choose two rows for the same volunteer. Original scans remain
              unchanged. Review the combined times before saving attendance.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["target", "source"] as const).map((kind) => (
                <select
                  key={kind}
                  aria-label={
                    kind === "target" ? "Keep row" : "Combine source row"
                  }
                  className="rounded border bg-background p-2"
                  value={kind === "target" ? targetId : sourceId}
                  onChange={(e) => {
                    if (kind === "target") setTargetId(e.target.value);
                    else setSourceId(e.target.value);
                    setCombineConfirmed(false);
                    setCombineKey(crypto.randomUUID());
                  }}
                >
                  <option value="">
                    {kind === "target" ? "Keep row…" : "Combine with row…"}
                  </option>
                  {unfinished
                    .filter((row) => row.decision !== "exclude")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        Row {row.sheetRowNumber}:{" "}
                        {row.name || row.email || "Unnamed"}
                      </option>
                    ))}
                </select>
              ))}
            </div>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={combineConfirmed}
                onChange={(e) => setCombineConfirmed(e.target.checked)}
              />
              I checked that both rows belong to the same volunteer.
            </label>
            <Button
              variant="outline"
              disabled={
                busy ||
                !combineConfirmed ||
                !sourceId ||
                !targetId ||
                sourceId === targetId
              }
              onClick={combine}
            >
              Combine and review
            </Button>
          </div>
        </details>
      )}
      <div className="sticky bottom-0 rounded-lg border bg-background p-4 space-y-3 shadow-sm">
        <p className="text-sm">
          {ready.length} reviewed rows ready to save. Other rows stay here for
          later review.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowOverCapacity}
            onChange={(e) => {
              setAllowOverCapacity(e.target.checked);
            }}
          />
          Allow reviewed walk-ins to exceed the scheduled volunteer capacity.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={commit} disabled={busy || !ready.length}>
            {busy ? "Saving…" : `Save ${ready.length} reviewed rows`}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || discarding || rows.some(hasPersistedAttendance)}
            onClick={onDiscard}
          >
            Discard draft
          </Button>
        </div>
      </div>
      {editing && (
        <ReviewRowEditor
          projectId={projectId}
          batchId={batch.id}
          row={editing}
          timezone={timezone}
          window={window}
          sourceUrl={
            images.find((image) => image.imageId === editing.imageId)?.url
          }
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((current) =>
              current.map((row) => (row.id === updated.id ? updated : row)),
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
