"use client";

import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import type { ScanProgress, ScanResult } from "./dashboard-types";

function resultBadge(result: ScanResult) {
  if (!result.success) {
    return { label: "Failed", tone: "destructive" as const };
  }
  if (result.itemType !== "project") {
    return { label: "Triaged", tone: "info" as const };
  }
  return result.flagged
    ? { label: "Flagged", tone: "destructive" as const }
    : { label: "Clean", tone: "success" as const };
}

export function ScanProgressDialog({
  open,
  onOpenChange,
  scanProgress,
  scanResults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scanProgress: ScanProgress | null;
  scanResults: ScanResult[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>AI moderation scan</DialogTitle>
          <DialogDescription>
            Analyzing content with step-by-step reasoning...
          </DialogDescription>
        </DialogHeader>

        {scanProgress && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span className="font-medium tabular-nums">
                  {scanProgress.percentComplete}%
                </span>
              </div>
              <Progress value={scanProgress.percentComplete} className="h-2" />
            </div>

            <dl className="grid grid-cols-2 divide-x border-y text-sm">
              <div className="grid gap-0.5 py-3 pr-4">
                <dt className="text-muted-foreground text-xs">
                  Reports processed
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {scanProgress.reportsProcessed}
                </dd>
              </div>
              <div className="grid gap-0.5 py-3 pl-4">
                <dt className="text-muted-foreground text-xs">
                  Projects scanned
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {scanProgress.projectsProcessed}
                </dd>
              </div>
            </dl>

            {scanProgress.currentItem && (
              <div className="flex items-start gap-2 text-sm">
                <Loader2
                  className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    Analyzing {scanProgress.currentItemType}
                  </p>
                  <p className="truncate font-medium">
                    {scanProgress.currentItem}
                  </p>
                </div>
              </div>
            )}

            {scanResults.length > 0 && (
              <ul className="max-h-40 divide-y overflow-y-auto border-t">
                {scanResults.slice(-5).map((result, i) => {
                  const verdict = (result.result as { verdict?: string })
                    ?.verdict;
                  const badge = resultBadge(result);

                  return (
                    <li
                      key={`${result.itemId}-${i}`}
                      className="flex items-center gap-2 py-2 text-xs"
                    >
                      <span className="capitalize">{result.itemType}</span>
                      <Badge variant={badge.tone}>{badge.label}</Badge>
                      {verdict && (
                        <span className="text-muted-foreground ml-auto max-w-40 truncate">
                          {verdict}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
