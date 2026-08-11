"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

import { ReviewRowEditor } from "./ReviewRowEditor";
import {
  commitPaperScanBatch,
  getPaperScanImageUrls,
  updatePaperScanRow,
} from "./actions";
import type {
  CommitSummary,
  PaperScanBatchView,
  PaperScanRowView,
} from "./PaperSignupsClient";

const LOW_CONFIDENCE = 0.7;

interface ReviewTableProps {
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

function formatTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function CellValue({
  value,
  confidence,
}: {
  value: string | null;
  confidence: number;
}) {
  if (value === null || value.length === 0) {
    return <Badge variant="outline">unreadable</Badge>;
  }
  return (
    <span
      className={cn(
        confidence < LOW_CONFIDENCE &&
          "rounded ring-2 ring-amber-400/70 px-1 -mx-1",
      )}
      title={
        confidence < LOW_CONFIDENCE
          ? `Low transcription confidence (${Math.round(confidence * 100)}%) — check against the photo`
          : undefined
      }
    >
      {value}
    </span>
  );
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
}: ReviewTableProps) {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<PaperScanRowView[]>(initialRows);
  const [editingRow, setEditingRow] = useState<PaperScanRowView | null>(null);
  const [images, setImages] = useState<
    Array<{ imageId: string; sequence: number; url: string }>
  >([]);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [allowOverCapacity, setAllowOverCapacity] = useState(false);
  const [committing, setCommitting] = useState(false);
  // One key per review session: retries of the same commit replay, never
  // duplicate.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    getPaperScanImageUrls({ projectId, batchId: batch.id }).then((result) => {
      if (!cancelled && "urls" in result) setImages(result.urls);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, batch.id]);

  const included = useMemo(
    () => rows.filter((row) => row.decision === "include"),
    [rows],
  );
  const summary = useMemo(() => {
    const withEmail = included.filter((row) => row.email);
    const rosterOnly = included.filter((row) => !row.email && row.name);
    const excluded = rows.filter((row) => row.decision !== "include");
    const duplicates = rows.filter((row) =>
      row.outcomeDetail?.startsWith("duplicate_of_row_"),
    );
    return { withEmail, rosterOnly, excluded, duplicates };
  }, [rows, included]);

  const patchRow = async (
    row: PaperScanRowView,
    patch: Parameters<typeof updatePaperScanRow>[0]["patch"],
    optimistic: Partial<PaperScanRowView>,
  ) => {
    const previous = rows;
    setRows((current) =>
      current.map((candidate) =>
        candidate.id === row.id ? { ...candidate, ...optimistic } : candidate,
      ),
    );
    const result = await updatePaperScanRow({
      projectId,
      batchId: batch.id,
      rowId: row.id,
      patch,
    });
    if ("error" in result) {
      setRows(previous);
      toast.error(result.error);
    }
  };

  const toggleInclude = (row: PaperScanRowView, checked: boolean) => {
    const decision = checked ? "include" : "exclude";
    void patchRow(row, { decision }, { decision });
  };

  const commit = async () => {
    setCommitting(true);
    const result = await commitPaperScanBatch({
      projectId,
      batchId: batch.id,
      rowIds: included.map((row) => row.id),
      allowOverCapacity,
      idempotencyKey,
    });
    setCommitting(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onCommitted(result);
  };

  const rowHighlights = (row: PaperScanRowView) =>
    row.outcomeDetail?.startsWith("duplicate_of_row_") ? (
      <Badge variant="secondary" className="gap-1">
        <AlertTriangle className="size-3" />
        duplicate of row {row.outcomeDetail.replace("duplicate_of_row_", "")}
      </Badge>
    ) : row.matchScore !== null && row.matchScore < 0.82 ? (
      <Badge variant="outline">verify match</Badge>
    ) : row.matchKind !== "none" ? (
      <Badge variant="secondary">matched</Badge>
    ) : null;

  return (
    <div className="space-y-4 pb-28">
      {/* Source photos: reviewing a transcription without the photo in view
          is not review. */}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto rounded-lg border bg-muted/30 p-2">
          {images.map((image) => (
            <button
              key={image.imageId}
              type="button"
              onClick={() => setZoomedImage(image.url)}
              className="shrink-0"
              aria-label={`View sheet page ${image.sequence + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Sheet page ${image.sequence + 1}`}
                className="h-24 rounded border object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {zoomedImage && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomedImage(null)}
          aria-label="Close photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedImage}
            alt="Sheet page"
            className="max-h-full max-w-full rounded"
          />
        </button>
      )}

      {sessionPublished && (
        <Card className="border-amber-400/60">
          <CardHeader className="py-4">
            <CardTitle className="text-sm">
              This session&apos;s hours are already published
            </CardTitle>
            <CardDescription>
              Confirmed rows will get certificates immediately instead of going
              through the hours review page.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 size-8" />
            No rows were read from the photos. Try re-scanning with clearer
            photos.
          </CardContent>
        </Card>
      ) : isMobile ? (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={row.decision === "include"}
                    onCheckedChange={(checked) =>
                      toggleInclude(row, checked === true)
                    }
                    aria-label={`Include row ${row.sheetRowNumber}`}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">
                      <CellValue
                        value={row.name}
                        confidence={row.fieldConfidence.name}
                      />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <CellValue
                        value={row.email}
                        confidence={row.fieldConfidence.email}
                      />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(row.checkInTime, timezone)} –{" "}
                      {formatTime(row.checkOutTime, timezone)}
                      {row.signaturePresent ? " · signed" : ""}
                    </p>
                    <div className="mt-1">{rowHighlights(row)}</div>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditingRow(row)}
                  aria-label={`Edit row ${row.sheetRowNumber}`}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="w-10">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Signed</TableHead>
                <TableHead>Match</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    row.decision !== "include" && "opacity-50",
                  )}
                >
                  <TableCell>
                    <Checkbox
                      checked={row.decision === "include"}
                      onCheckedChange={(checked) =>
                        toggleInclude(row, checked === true)
                      }
                      aria-label={`Include row ${row.sheetRowNumber}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sheetRowNumber}
                  </TableCell>
                  <TableCell>
                    <CellValue
                      value={row.name}
                      confidence={row.fieldConfidence.name}
                    />
                  </TableCell>
                  <TableCell>
                    <CellValue
                      value={row.email}
                      confidence={row.fieldConfidence.email}
                    />
                  </TableCell>
                  <TableCell>
                    <CellValue
                      value={row.phone}
                      confidence={row.fieldConfidence.phone}
                    />
                  </TableCell>
                  <TableCell>{formatTime(row.checkInTime, timezone)}</TableCell>
                  <TableCell>
                    {formatTime(row.checkOutTime, timezone)}
                  </TableCell>
                  <TableCell>{row.signaturePresent ? "Yes" : "—"}</TableCell>
                  <TableCell>{rowHighlights(row)}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditingRow(row)}
                      aria-label={`Edit row ${row.sheetRowNumber}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editingRow && (
        <ReviewRowEditor
          projectId={projectId}
          batchId={batch.id}
          row={editingRow}
          timezone={timezone}
          window={window}
          onClose={() => setEditingRow(null)}
          onSaved={(updated) => {
            setRows((current) =>
              current.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            );
            setEditingRow(null);
          }}
        />
      )}

      {/* Sticky commit bar: the consequence must be legible at the moment of
          the click. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur">
        <div className="container mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <strong>{summary.withEmail.length}</strong> will become attendance
            records · <strong>{summary.rosterOnly.length}</strong> roster-only
            (no email) · <strong>{summary.excluded.length}</strong> excluded
            {summary.duplicates.length > 0 && (
              <> · {summary.duplicates.length} flagged duplicate</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={discarding || committing}
            >
              <Trash2 className="size-4" />
              Discard
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button disabled={committing || included.length === 0}>
                    Confirm {included.length} row
                    {included.length === 1 ? "" : "s"}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Record these signups?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {summary.withEmail.length} attendance record
                    {summary.withEmail.length === 1 ? "" : "s"} will be created
                    or updated, and {summary.rosterOnly.length} roster-only
                    entr{summary.rosterOnly.length === 1 ? "y" : "ies"} saved.
                    Volunteers with a new record are emailed a link to it. This
                    can&apos;t be undone from this screen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <Checkbox
                    id="allow-over-capacity"
                    checked={allowOverCapacity}
                    onCheckedChange={(checked) =>
                      setAllowOverCapacity(checked === true)
                    }
                  />
                  <Label
                    htmlFor="allow-over-capacity"
                    className="text-sm font-normal leading-snug"
                  >
                    Record attendees even if it exceeds the slot&apos;s
                    volunteer cap (the event already happened)
                  </Label>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction onClick={commit} disabled={committing}>
                    {committing ? "Recording…" : "Record signups"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}
