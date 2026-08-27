"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ScanText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { downscaleImageFiles } from "@/components/projects/paper-signup/useImageDownscale";
import { PaperScanCameraInput } from "@/components/projects/paper-signup/PaperScanCameraInput";
import { PAPER_SCAN_MAX_IMAGES } from "@/lib/ai/paper-signup-schema";

import { createPaperScanBatch, queueOrphanedPaperScanUploads } from "./actions";
import type {
  PaperScanBatchView,
  PaperScanSlotOption,
} from "./PaperSignupsClient";

interface PendingPhoto {
  key: string;
  file: File;
}

interface PendingCleanup {
  cleanupToken: string;
  objectPaths: string[];
}

interface CaptureStepProps {
  projectId: string;
  slot: PaperScanSlotOption;
  existingBatch: PaperScanBatchView | null;
  onBack: () => void;
  onExtracted: (batch: PaperScanBatchView) => void;
}

type Phase =
  | { kind: "collecting" }
  | { kind: "compressing"; index: number; total: number }
  | { kind: "uploading"; index: number; total: number }
  | { kind: "scanning" };

const PREVIEW_MAX_EDGE = 800;
const SCAN_REQUEST_TIMEOUT_MS = 285_000;
const RECOVERY_POLL_INTERVAL_MS = 2_000;
const RECOVERY_POLL_BUDGET_MS = 315_000;

const photoKey = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}`;

function PaperPhotoPreview({ file, label }: { file: File; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let bitmap: ImageBitmap | null = null;

    void createImageBitmap(file)
      .then((decoded) => {
        bitmap = decoded;
        const canvas = canvasRef.current;
        if (!active || !canvas) {
          decoded.close();
          bitmap = null;
          return;
        }

        const scale = Math.min(
          1,
          PREVIEW_MAX_EDGE / Math.max(decoded.width, decoded.height),
        );
        canvas.width = Math.max(1, Math.round(decoded.width * scale));
        canvas.height = Math.max(1, Math.round(decoded.height * scale));
        canvas
          .getContext("2d")
          ?.drawImage(decoded, 0, 0, canvas.width, canvas.height);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      bitmap?.close();
    };
  }, [file]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="size-full rounded-md border object-cover"
    />
  );
}

export function CaptureStep({
  projectId,
  slot,
  existingBatch,
  onBack,
  onExtracted,
}: CaptureStepProps) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "collecting" });
  const [pendingCleanup, setPendingCleanup] = useState<PendingCleanup | null>(
    null,
  );
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const busy = phase.kind !== "collecting" || cleanupBusy;
  const cleanupStorageKey = `paper-scan-orphan-cleanup:${projectId}`;

  useEffect(() => {
    const stored = window.localStorage.getItem(cleanupStorageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as PendingCleanup;
      if (
        typeof parsed.cleanupToken === "string" &&
        Array.isArray(parsed.objectPaths) &&
        parsed.objectPaths.every((path) => typeof path === "string")
      ) {
        setPendingCleanup(parsed);
        return;
      }
    } catch {
      // Invalid browser-local recovery data must not block a fresh scan.
    }
    window.localStorage.removeItem(cleanupStorageKey);
  }, [cleanupStorageKey]);

  useEffect(() => {
    if (existingBatch?.status !== "extracting") return;

    let active = true;
    const supabase = createBrowserSupabaseClient();
    const check = async () => {
      const { data, error } = await supabase
        .from("project_paper_scan_batches")
        .select("status")
        .eq("id", existingBatch.id)
        .eq("project_id", projectId)
        .maybeSingle();
      if (active && !error && data?.status !== "extracting") {
        window.location.reload();
      }
    };

    void check();
    const intervalId = window.setInterval(
      () => void check(),
      RECOVERY_POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [existingBatch?.id, existingBatch?.status, projectId]);

  const rememberPendingCleanup = (cleanup: PendingCleanup) => {
    window.localStorage.setItem(cleanupStorageKey, JSON.stringify(cleanup));
    setPendingCleanup(cleanup);
  };

  const releaseOrphanedUploads = async (cleanup: PendingCleanup) => {
    const queueResult = await queueOrphanedPaperScanUploads({
      projectId,
      cleanupToken: cleanup.cleanupToken,
      objectPaths: cleanup.objectPaths,
    }).catch(() => ({ error: "Cleanup request failed." }));
    if ("success" in queueResult) {
      window.localStorage.removeItem(cleanupStorageKey);
      return true;
    }
    if ("registered" in queueResult) {
      // The batch-registration response was lost after commit. Preserve the
      // now-referenced evidence and reload into the durable batch instead of
      // treating it as an orphan or deleting it through the browser policy.
      window.localStorage.removeItem(cleanupStorageKey);
      window.location.reload();
      return true;
    }
    return false;
  };

  const retryOrphanCleanup = async () => {
    if (!pendingCleanup) return;
    setCleanupBusy(true);
    const released = await releaseOrphanedUploads(pendingCleanup);
    setCleanupBusy(false);
    if (released) {
      setPendingCleanup(null);
      toast.success("Uploaded photos were safely released.");
      return;
    }
    toast.error(
      "Cleanup still could not be saved. Please retry before leaving.",
    );
  };

  const addFiles = (files: File[]) => {
    setPhotos((current) => {
      const existing = new Set(current.map((photo) => photo.key));
      const additions = files
        .filter((file) => !existing.has(photoKey(file)))
        .slice(0, PAPER_SCAN_MAX_IMAGES - current.length)
        .map((file) => ({
          key: photoKey(file),
          file,
        }));
      if (current.length + files.length > PAPER_SCAN_MAX_IMAGES) {
        toast.warning(`Up to ${PAPER_SCAN_MAX_IMAGES} photos per scan.`);
      }
      return [...current, ...additions];
    });
  };

  const removePhoto = (key: string) => {
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  };

  const scan = async () => {
    if (photos.length === 0) return;
    const supabase = createBrowserSupabaseClient();
    const batchDir = crypto.randomUUID();
    const cleanupToken = crypto.randomUUID();
    const uploadedPaths: string[] = [];
    let registeredBatchId: string | null = null;

    try {
      setPhase({ kind: "compressing", index: 0, total: photos.length });
      const downscaled = await downscaleImageFiles(
        photos.map((photo) => photo.file),
        {
          onProgress: (index, total) =>
            setPhase({ kind: "compressing", index, total }),
        },
      );

      const images: Array<{
        objectPath: string;
        sequence: number;
        byteSize: number;
        contentType: string;
      }> = [];
      for (let index = 0; index < downscaled.length; index++) {
        setPhase({ kind: "uploading", index, total: downscaled.length });
        const item = downscaled[index];
        const extension =
          item.file.type === "image/png"
            ? "png"
            : item.file.type === "image/webp"
              ? "webp"
              : "jpg";
        const objectPath = `paper_signups/${projectId}/${batchDir}/${index}_${crypto
          .randomUUID()
          .replace(/-/g, "")}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("paper-signup-scans")
          .upload(objectPath, item.file, {
            contentType: item.file.type,
            metadata: { cleanupToken },
          });
        if (uploadError) {
          throw new Error("One of the photos failed to upload.");
        }
        uploadedPaths.push(objectPath);
        images.push({
          objectPath,
          sequence: index,
          byteSize: item.file.size,
          contentType: item.file.type,
        });
      }

      const batchResult = await createPaperScanBatch({
        projectId,
        scheduleId: slot.id,
        images,
      });
      if ("error" in batchResult) {
        throw new Error(batchResult.error);
      }
      registeredBatchId = batchResult.batchId;

      setPhase({ kind: "scanning" });
      const scanController = new AbortController();
      const scanTimeoutId = window.setTimeout(
        () => scanController.abort(),
        SCAN_REQUEST_TIMEOUT_MS,
      );
      const response = await fetch("/api/ai/scan-signup-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batchResult.batchId }),
        signal: scanController.signal,
      }).finally(() => window.clearTimeout(scanTimeoutId));
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Scanning failed. Please try again.");
      }

      toast.success(
        `Read ${payload.rowCount} row${payload.rowCount === 1 ? "" : "s"} from ${payload.imagesProcessed} photo${payload.imagesProcessed === 1 ? "" : "s"}.`,
      );
      onExtracted({
        id: batchResult.batchId,
        scheduleId: slot.id,
        status: "review",
        imageCount: images.length,
      });
    } catch (error) {
      // Only uploads that never became part of a batch are orphans. Once the
      // batch exists, an extraction response can be lost after the server has
      // already advanced it to review, so deleting those photos would destroy
      // evidence that the recovered review still needs.
      if (registeredBatchId === null && uploadedPaths.length > 0) {
        const cleanup = { cleanupToken, objectPaths: uploadedPaths };
        if (!(await releaseOrphanedUploads(cleanup))) {
          rememberPendingCleanup(cleanup);
        }
      }
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
      if (registeredBatchId !== null) {
        // The extraction request may have completed even when its response was
        // lost. Wait until the durable batch leaves its in-progress states so
        // a reload cannot race the worker and present a second uploader while
        // the first scan is still being processed.
        const batchId = registeredBatchId;
        const recoveryDeadline = Date.now() + RECOVERY_POLL_BUDGET_MS;
        while (Date.now() < recoveryDeadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          const { data: recoveredBatch, error: recoveryError } = await supabase
            .from("project_paper_scan_batches")
            .select("status")
            .eq("id", batchId)
            .eq("project_id", projectId)
            .maybeSingle();

          if (recoveryError) continue;
          if (
            recoveredBatch === null ||
            recoveredBatch.status === "draft" ||
            recoveredBatch.status === "review" ||
            recoveredBatch.status === "failed" ||
            recoveredBatch.status === "committed" ||
            recoveredBatch.status === "discarded"
          ) {
            window.location.reload();
            return;
          }
        }
        // Never leave the browser in an endless spinner when RLS, connectivity,
        // or a provider outage prevents recovery polling. The durable batch and
        // its photos remain intact; a reload can resume review or show the
        // current failure state.
        window.location.reload();
        return;
      }
      setPhase({ kind: "collecting" });
    }
  };

  if (existingBatch?.status === "extracting") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reading the uploaded sheet</CardTitle>
          <CardDescription>
            The photos are safely uploaded. This page will open review as soon
            as extraction finishes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Checking scan progress…
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Refresh status
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Photograph the sheet</CardTitle>
        <CardDescription>
          {slot.label} · Lay the sheet flat, fill the frame, and avoid shadows.
          Add every page of the sheet before scanning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingCleanup && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p>
              The scan failed and its uploaded photos still need to be released.
              Retry cleanup before leaving this page.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={cleanupBusy}
              onClick={retryOrphanCleanup}
            >
              {cleanupBusy ? "Retrying cleanup…" : "Retry cleanup"}
            </Button>
          </div>
        )}
        {existingBatch && existingBatch.status !== "review" && (
          <p className="text-sm text-muted-foreground">
            A previous scan for this project didn&apos;t finish; starting a new
            one replaces it.
          </p>
        )}

        <PaperScanCameraInput
          disabled={busy || photos.length >= PAPER_SCAN_MAX_IMAGES}
          onFiles={addFiles}
        />

        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((photo, index) => (
              <li key={photo.key} className="relative">
                <AspectRatio ratio={3 / 4}>
                  <PaperPhotoPreview
                    file={photo.file}
                    label={`Sheet page ${index + 1}`}
                  />
                </AspectRatio>
                <Badge
                  variant="secondary"
                  className="absolute left-1 top-1 px-1.5 py-0 text-xs"
                >
                  {index + 1}
                </Badge>
                {!busy && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={`Remove page ${index + 1}`}
                    onClick={() => removePhoto(photo.key)}
                    className="absolute right-1 top-1 size-7 text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {busy && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {phase.kind === "compressing" &&
                `Preparing photo ${phase.index + 1} of ${phase.total}…`}
              {phase.kind === "uploading" &&
                `Uploading photo ${phase.index + 1} of ${phase.total}…`}
              {phase.kind === "scanning" &&
                "Reading the sheet — this can take a minute for several pages…"}
            </div>
            {(phase.kind === "compressing" || phase.kind === "uploading") && (
              <Progress
                aria-label="Upload progress"
                value={phase.total > 0 ? (phase.index / phase.total) * 100 : 0}
                className="h-1.5"
              />
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="size-4" />
          Change session
        </Button>
        <Button
          onClick={scan}
          disabled={busy || pendingCleanup !== null || photos.length === 0}
          className="w-full sm:w-auto"
        >
          <ScanText className="size-4" />
          Scan{" "}
          {photos.length > 0
            ? `${photos.length} photo${photos.length === 1 ? "" : "s"}`
            : "sheet"}
        </Button>
      </CardFooter>
    </Card>
  );
}
