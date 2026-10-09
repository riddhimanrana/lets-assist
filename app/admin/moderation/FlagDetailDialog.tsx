"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { humanize, levelTone, statusTone } from "../components/admin-status";
import { takeFlaggedContentAction } from "./actions";
import {
  formatConfidencePercent,
  formatFlagStatus,
  formatSafeDate,
  getFlagContentUrl,
} from "./dashboard-format";
import type { FlaggedContent, FlaggedFilter } from "./dashboard-types";

export function FlagDetailDialog({
  selectedFlag,
  onClose,
  isActionLoading,
  handleRunAiReviewForFlag,
  handleFlagStatusUpdate,
}: {
  selectedFlag: FlaggedContent | null;
  onClose: () => void;
  isActionLoading: boolean;
  handleRunAiReviewForFlag: (flag: FlaggedContent) => Promise<void>;
  handleFlagStatusUpdate: (
    id: string,
    status: FlaggedFilter,
    notes?: string,
  ) => Promise<void>;
}) {
  const contentUrl = selectedFlag ? getFlagContentUrl(selectedFlag) : null;
  const reasoningSteps = selectedFlag?.flag_details?.reasoningSteps ?? [];

  return (
    <Dialog
      open={Boolean(selectedFlag)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Flag details</DialogTitle>
          <DialogDescription>
            Review the flagged content and take action.
          </DialogDescription>
        </DialogHeader>
        {selectedFlag && (
          <>
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusTone(selectedFlag.status)}>
                  {formatFlagStatus(selectedFlag.status)}
                </Badge>
                <Badge variant={levelTone(selectedFlag.severity)}>
                  {humanize(selectedFlag.severity, "Unknown")}
                </Badge>
                {selectedFlag.flag_type && (
                  <Badge variant="outline">
                    {humanize(selectedFlag.flag_type)}
                  </Badge>
                )}
                {selectedFlag.confidence_score !== undefined &&
                  selectedFlag.confidence_score !== null && (
                    <span className="text-muted-foreground text-xs">
                      {formatConfidencePercent(
                        Number(selectedFlag.confidence_score),
                      )}{" "}
                      confidence
                    </span>
                  )}
                <span className="text-muted-foreground ml-auto text-sm">
                  {formatSafeDate(selectedFlag.created_at, "PPP p")}
                </span>
              </div>

              <dl className="grid gap-4 border-y py-4 text-sm md:grid-cols-2">
                <div className="grid content-start gap-1">
                  <dt className="font-medium">Reason for flag</dt>
                  <dd className="text-muted-foreground">
                    {selectedFlag.flag_details?.shortSummary ||
                      selectedFlag.reason ||
                      "No reason provided"}
                  </dd>
                </div>

                {selectedFlag.flag_details?.reasoning && (
                  <div className="grid content-start gap-1">
                    <dt className="font-medium">AI verdict</dt>
                    <dd className="text-muted-foreground">
                      {selectedFlag.flag_details.verdict ||
                        selectedFlag.flag_details.reasoning}
                    </dd>
                  </div>
                )}
              </dl>

              {reasoningSteps.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "group -ml-2.5 justify-start",
                    )}
                  >
                    <ChevronRight className="transition-transform group-data-panel-open:rotate-90" />
                    Reasoning steps ({reasoningSteps.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ol className="grid gap-4 pt-3">
                      {reasoningSteps.map((step, idx) => (
                        <li
                          key={idx}
                          className="grid gap-1 border-l pl-3 text-sm"
                        >
                          <p className="font-medium">
                            <span className="text-muted-foreground">
                              Step {step.step}
                            </span>{" "}
                            {step.title}
                          </p>
                          <p className="text-muted-foreground">
                            {step.analysis}
                          </p>
                          <p className="text-xs font-medium">
                            → {step.conclusion}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>

            <DialogFooter className="flex-wrap">
              {contentUrl && (
                <Link
                  href={contentUrl}
                  target="_blank"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  <ExternalLink data-icon="inline-start" />
                  View content
                </Link>
              )}

              {selectedFlag.content_type === "project" &&
                selectedFlag.content_id && (
                  <Button
                    variant="outline"
                    onClick={() => handleRunAiReviewForFlag(selectedFlag)}
                    disabled={isActionLoading}
                  >
                    <Sparkles data-icon="inline-start" />
                    Re-run AI
                  </Button>
                )}

              <Button
                variant="ghost"
                onClick={() =>
                  handleFlagStatusUpdate(
                    selectedFlag.id,
                    "dismissed",
                    "Dismissed as false positive",
                  )
                }
                disabled={isActionLoading}
              >
                Dismiss
              </Button>

              <Button
                variant="destructive"
                onClick={() =>
                  takeFlaggedContentAction(
                    selectedFlag.id,
                    "block_content",
                    "Blocked via moderation review",
                  )
                }
                disabled={isActionLoading}
              >
                Block content
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
