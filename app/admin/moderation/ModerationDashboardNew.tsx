"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { SparklesIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AdminPage } from "../components/AdminPage";
import { getReportColumns, getFlaggedColumns } from "./columns";
import { formatSafeDate } from "./dashboard-format";
import type {
  ContentReport,
  FlaggedContent,
  FlaggedFilter,
  ModerationStats,
  ReportsFilter,
  ReportsStats,
} from "./dashboard-types";
import { DataTable } from "./data-table";
import { FlagDetailDialog } from "./FlagDetailDialog";
import { ModerationQueue } from "./ModerationQueue";
import { ReportDetailSheet } from "./ReportDetailSheet";
import { ScanProgressDialog } from "./ScanProgressDialog";
import { useModerationDashboard } from "./use-moderation-dashboard";

export default function ModerationDashboard({
  initialStats,
  initialFlagged,
  initialReports,
  initialReportsStats,
}: {
  initialStats: ModerationStats;
  initialFlagged: FlaggedContent[];
  initialReports: ContentReport[];
  initialReportsStats: ReportsStats;
}) {
  const stats = initialStats;
  const reportsStats = initialReportsStats;
  const dashboard = useModerationDashboard({ initialFlagged, initialReports });
  const {
    flaggedContent,
    contentReports,
    flaggedFilter,
    reportFilter,
    isScanActive,
    scanProgress,
    setSelectedReport,
    setSelectedFlag,
  } = dashboard;
  const scanIcon = useAnimatedIcon();

  const automationLastRunLabel = stats.lastAutomationAt
    ? formatSafeDate(stats.lastAutomationAt, "PPP p")
    : "No automation run recorded yet";

  const reportColumns = useMemo(
    () => getReportColumns(setSelectedReport),
    [setSelectedReport],
  );

  const flaggedColumns = useMemo(
    () => getFlaggedColumns(setSelectedFlag),
    [setSelectedFlag],
  );

  return (
    <TooltipProvider>
      <AdminPage>
        <PageHeader
          title="Content moderation"
          description="Clear review workflow for queue triage, AI approvals, and automated moderation runs."
          meta={
            <>
              <span>Auto-run: every 24 hours</span>
              <span>Last run: {automationLastRunLabel}</span>
            </>
          }
          actions={
            <Button
              onClick={dashboard.handleRunAiScan}
              disabled={isScanActive}
              {...scanIcon.triggerProps}
            >
              {isScanActive ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <SparklesIcon
                  ref={scanIcon.ref}
                  size={16}
                  aria-hidden="true"
                  data-icon="inline-start"
                />
              )}
              {isScanActive ? "Scanning..." : "Run AI scan now"}
            </Button>
          }
        />

        <StatStrip
          items={[
            {
              label: "Human filed reports",
              value: stats.pendingReports,
              helper: "Reports waiting for moderator decisions",
            },
            {
              label: "Ongoing AI moderation",
              value: stats.pendingFlags,
              helper: "AI project flags awaiting review (manual run available)",
            },
            {
              label: "Resolved cases",
              value: stats.resolved,
              helper: "Reports and flags closed by moderation decisions",
            },
            {
              label: "AI approved actions",
              value: stats.aiApproved,
              helper: "Times moderators accepted AI recommendations",
            },
            {
              label: "Critical / recent",
              value: stats.critical,
              helper: `${stats.automationLast24h} AI outputs in 24h · ${stats.recentWeek} new this week`,
            },
          ]}
        />

        <ScanProgressDialog
          open={isScanActive}
          onOpenChange={(open) =>
            !open && !scanProgress && dashboard.setIsScanActive(false)
          }
          scanProgress={scanProgress}
          scanResults={dashboard.scanResults}
        />

        <Tabs defaultValue="reports" className="gap-6">
          <TabsList variant="line" className="border-b">
            <TabsTrigger value="reports" className="flex-none">
              Reports queue ({stats.pendingReports})
            </TabsTrigger>
            <TabsTrigger value="flagged" className="flex-none">
              AI flags queue ({stats.pendingFlags})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reports">
            <ModerationQueue<ReportsFilter>
              title="User reports"
              description={`Manual reports with AI analysis. ${reportsStats.resolved} reports resolved so far.`}
              filter={reportFilter}
              filters={[
                {
                  value: "pending",
                  label: `Pending (${stats.pendingReports})`,
                },
                { value: "under_review", label: "In review" },
                { value: "resolved", label: "Resolved" },
                { value: "dismissed", label: "Dismissed" },
              ]}
              onFilterChange={(next) => {
                dashboard.setReportFilter(next);
                dashboard.loadContentReports(next);
              }}
              isLoading={dashboard.isReportsLoading}
              isEmpty={contentReports.length === 0}
              emptyTitle="All caught up"
              emptyDescription={`There are no reports in the ${reportFilter.replace("_", " ")} queue right now.`}
            >
              {/* @ts-ignore - structural typing match mostly fine, ignoring distinct type definition mismatch for now */}
              <DataTable
                columns={reportColumns}
                data={contentReports}
                searchKey="reason"
                rowNoun="report"
              />
            </ModerationQueue>
          </TabsContent>

          <TabsContent value="flagged">
            <ModerationQueue<FlaggedFilter>
              title="AI flagged content"
              description="Automatically detected policy violations"
              filter={flaggedFilter}
              filters={[
                { value: "pending", label: `Pending (${stats.pendingFlags})` },
                { value: "blocked", label: "Blocked" },
                { value: "confirmed", label: "Confirmed" },
                { value: "dismissed", label: "Dismissed" },
              ]}
              onFilterChange={(next) => {
                dashboard.setFlaggedFilter(next);
                dashboard.loadFlaggedContent(next);
              }}
              isLoading={dashboard.isFlaggedLoading}
              isEmpty={flaggedContent.length === 0}
              emptyTitle="Clean slate"
              emptyDescription={`No flagged content found in the ${flaggedFilter} queue.`}
            >
              {/* @ts-ignore */}
              <DataTable
                columns={flaggedColumns}
                data={flaggedContent}
                searchKey="content_details"
                rowNoun="flag"
              />
            </ModerationQueue>
          </TabsContent>
        </Tabs>

        <FlagDetailDialog
          selectedFlag={dashboard.selectedFlag}
          onClose={() => setSelectedFlag(null)}
          isActionLoading={dashboard.isActionLoading}
          handleRunAiReviewForFlag={dashboard.handleRunAiReviewForFlag}
          handleFlagStatusUpdate={dashboard.handleFlagStatusUpdate}
        />

        <ReportDetailSheet
          selectedReport={dashboard.selectedReport}
          onClose={() => setSelectedReport(null)}
          isActionLoading={dashboard.isActionLoading}
          handleReportAiApproval={dashboard.handleReportAiApproval}
          handleReportStatusChange={dashboard.handleReportStatusChange}
          handleManualReportAction={dashboard.handleManualReportAction}
        />
      </AdminPage>
    </TooltipProvider>
  );
}
