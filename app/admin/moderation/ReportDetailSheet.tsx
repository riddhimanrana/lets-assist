"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CheckCircle, ExternalLink, Sparkles } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { parseReportDescription } from "@/lib/moderation/report-description";

import { humanize, levelTone, statusTone } from "../components/admin-status";
import {
  formatAiRecommendation,
  formatConfidencePercent,
  formatSafeDate,
  getReportContentUrl,
} from "./dashboard-format";
import {
  REPORT_DISMISS_NOTE,
  REPORT_RESOLVE_NOTE,
  type ContentReport,
  type ReportsFilter,
} from "./dashboard-types";

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ReportDetailSheet({
  selectedReport,
  onClose,
  isActionLoading,
  handleReportAiApproval,
  handleReportStatusChange,
  handleManualReportAction,
}: {
  selectedReport: ContentReport | null;
  onClose: () => void;
  isActionLoading: boolean;
  handleReportAiApproval: (report: ContentReport) => Promise<void>;
  handleReportStatusChange: (
    id: string,
    status: ReportsFilter,
    notes?: string,
  ) => Promise<void>;
  handleManualReportAction: (
    reportId: string,
    action: "warn_user" | "remove_content" | "block_content",
    reason?: string,
  ) => Promise<void>;
}) {
  const parsedReportDescription = useMemo(
    () => parseReportDescription(selectedReport?.description),
    [selectedReport?.description],
  );

  const reportContentUrl = selectedReport
    ? getReportContentUrl(
        selectedReport,
        parsedReportDescription.metadata.contentUrl,
      )
    : null;

  return (
    <Sheet
      open={Boolean(selectedReport)}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        {selectedReport && (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="text-lg">Report details</SheetTitle>
              <SheetDescription className="break-words">
                {selectedReport.reason || "Review report and take action"} · ID:{" "}
                {selectedReport.id}
              </SheetDescription>
            </SheetHeader>

            <div className="grid flex-1 content-start gap-5 overflow-y-auto p-4 sm:p-6">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Detail label="Status">
                  <Badge variant={statusTone(selectedReport.status)}>
                    {humanize(selectedReport.status, "pending")}
                  </Badge>
                </Detail>
                <Detail label="Priority">
                  <Badge variant={levelTone(selectedReport.priority)}>
                    {humanize(selectedReport.priority, "normal")}
                  </Badge>
                </Detail>
                <Detail label="Submitted">
                  {formatSafeDate(selectedReport.created_at, "PPP p")}
                </Detail>
              </dl>

              <Section title="Reported by">
                {selectedReport.reporter ? (
                  <Link
                    href={`/profile/${selectedReport.reporter.username || selectedReport.reporter.id}`}
                    className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-md p-2 transition-colors"
                  >
                    <Avatar className="size-9">
                      <AvatarImage
                        src={selectedReport.reporter.avatar_url || undefined}
                      />
                      <AvatarFallback>
                        {(
                          selectedReport.reporter.full_name?.[0] ||
                          selectedReport.reporter.username?.[0] ||
                          "U"
                        ).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {selectedReport.reporter.full_name ||
                          selectedReport.reporter.username ||
                          "Unknown"}
                      </p>
                      {selectedReport.reporter.username && (
                        <p className="text-muted-foreground truncate text-xs">
                          @{selectedReport.reporter.username}
                        </p>
                      )}
                    </div>
                    <ExternalLink
                      className="text-muted-foreground size-4"
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <div>
                    <p className="text-sm font-medium">
                      {selectedReport.reporter_label || "Anonymous"}
                    </p>
                    {selectedReport.reporter_label && (
                      <p className="text-muted-foreground text-xs">
                        Detached account · stable pseudonym
                      </p>
                    )}
                  </div>
                )}
              </Section>

              <Section title="Reported content">
                <div className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {selectedReport.content_type || "content"}
                    </Badge>
                    <span className="font-medium">
                      {parsedReportDescription.metadata.contentTitle ||
                        (selectedReport.content_type === "project"
                          ? selectedReport.content_details?.title ||
                            "Untitled project"
                          : selectedReport.creator_details?.full_name ||
                            "Unknown user")}
                    </span>
                  </div>

                  {parsedReportDescription.metadata.contentCreator && (
                    <p className="text-muted-foreground">
                      Creator:{" "}
                      <span className="text-foreground font-medium">
                        {parsedReportDescription.metadata.contentCreator}
                      </span>
                    </p>
                  )}

                  {reportContentUrl && (
                    <Link
                      href={reportContentUrl}
                      target="_blank"
                      className="text-primary inline-flex min-h-9 w-fit items-center gap-1.5 underline-offset-4 hover:underline"
                    >
                      Open content
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </Section>

              <Section title="Reason">
                <p className="text-muted-foreground text-sm">
                  {selectedReport.reason || "No reason provided"}
                </p>
                <dl className="grid gap-4">
                  <Detail label="Reporter notes">
                    <span className="whitespace-pre-wrap">
                      {parsedReportDescription.notes ||
                        "No additional notes provided."}
                    </span>
                  </Detail>
                  {parsedReportDescription.metadata.context && (
                    <Detail label="Captured context">
                      {parsedReportDescription.metadata.context}
                    </Detail>
                  )}
                  {parsedReportDescription.metadata.reportedAt && (
                    <Detail label="Reported at">
                      {formatSafeDate(
                        parsedReportDescription.metadata.reportedAt,
                        "PPP p",
                      )}
                    </Detail>
                  )}
                </dl>
              </Section>

              {selectedReport.ai_metadata?.triagedAt && (
                <Section
                  title="AI analysis"
                  aside={
                    <span className="text-muted-foreground text-xs">
                      {formatConfidencePercent(
                        selectedReport.ai_metadata.confidence,
                      )}{" "}
                      confident
                    </span>
                  }
                >
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Detail label="Verdict">
                        <span className="font-medium">
                          {selectedReport.ai_metadata.verdict}
                        </span>
                      </Detail>
                    </div>
                    {selectedReport.ai_metadata.shortSummary && (
                      <div className="sm:col-span-2">
                        <Detail label="Summary">
                          {selectedReport.ai_metadata.shortSummary}
                        </Detail>
                      </div>
                    )}
                    <Detail label="Recommended action">
                      <span className="capitalize">
                        {formatAiRecommendation(
                          selectedReport.ai_metadata.recommendedAction,
                          selectedReport.ai_metadata.suggestedStatus,
                        )}
                      </span>
                    </Detail>
                    <Detail label="Priority">
                      <Badge
                        variant={levelTone(selectedReport.ai_metadata.priority)}
                      >
                        {humanize(
                          selectedReport.ai_metadata.priority,
                          "Normal",
                        )}
                      </Badge>
                    </Detail>
                  </dl>
                </Section>
              )}
            </div>

            <SheetFooter className="flex-row flex-wrap justify-end border-t">
              {selectedReport.ai_metadata?.suggestedStatus && (
                <Button
                  variant="outline"
                  onClick={() => handleReportAiApproval(selectedReport)}
                  disabled={isActionLoading}
                >
                  <Sparkles data-icon="inline-start" />
                  Approve AI suggestion
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={() =>
                  handleReportStatusChange(
                    selectedReport.id,
                    "dismissed",
                    REPORT_DISMISS_NOTE,
                  )
                }
                disabled={isActionLoading}
              >
                Dismiss
              </Button>

              <Button
                variant="destructive"
                onClick={() =>
                  handleManualReportAction(
                    selectedReport.id,
                    "block_content",
                    "Blocked via moderation review",
                  )
                }
                disabled={isActionLoading}
              >
                Block content
              </Button>

              <Button
                onClick={() =>
                  handleReportStatusChange(
                    selectedReport.id,
                    "resolved",
                    REPORT_RESOLVE_NOTE,
                  )
                }
                disabled={isActionLoading}
              >
                <CheckCircle data-icon="inline-start" />
                Resolve case
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
