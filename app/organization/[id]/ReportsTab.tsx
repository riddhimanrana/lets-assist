"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "@daypicker/react";
import { endOfDay, startOfDay, startOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getOrganizationReportData,
  type OrganizationReportData,
} from "./reports/actions";
import { ReportsCharts } from "./reports/ReportsCharts";
import { ReportsSheetsStatus } from "./reports/ReportsSheetsStatus";
import { ReportsTopProjects } from "./reports/ReportsTopProjects";
import { getSheetSyncStatus, syncSheetNow } from "./reports/sheets-actions";

type ReportsTabProps = {
  organizationId: string;
  organizationSlug?: string;
  organizationName: string;
  userRole: string | null;
};

export default function ReportsTab({
  organizationId,
  organizationSlug,
  userRole,
}: ReportsTabProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonth(subMonths(new Date(), 11)),
    to: new Date(),
  }));
  const [reportData, setReportData] = useState<OrganizationReportData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [sheetStatus, setSheetStatus] = useState<Awaited<
    ReturnType<typeof getSheetSyncStatus>
  > | null>(null);
  const [syncingSheet, setSyncingSheet] = useState(false);

  const isAdmin = userRole === "admin";
  const orgSlugOrId = organizationSlug || organizationId;
  // Sheets configuration lives in settings; this tab only reports its status.
  const sheetsSettingsHref = `/organization/${orgSlugOrId}/settings?section=sheets`;

  const dateRangeParam = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return undefined;
    return {
      from: startOfDay(dateRange.from).toISOString(),
      to: endOfDay(dateRange.to).toISOString(),
    };
  }, [dateRange]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    const result = await getOrganizationReportData(
      organizationId,
      dateRangeParam,
    );
    if (result.error || !result.data) {
      toast.error(result.error || "Failed to load reports");
    } else {
      setReportData(result.data);
    }
    setLoading(false);
  }, [organizationId, dateRangeParam]);

  const handleLoadSheetStatus = useCallback(async () => {
    const status = await getSheetSyncStatus(organizationId);
    setSheetStatus(status);
  }, [organizationId]);

  const handleSyncSheetNow = useCallback(async () => {
    setSyncingSheet(true);
    const result = await syncSheetNow(organizationId);
    if (result.success) {
      toast.success("Sheet synced successfully");
      handleLoadSheetStatus();
    } else {
      toast.error(result.error || "Failed to sync sheet");
    }
    setSyncingSheet(false);
  }, [organizationId, handleLoadSheetStatus]);

  useEffect(() => {
    loadReport();
    handleLoadSheetStatus();
  }, [loadReport, handleLoadSheetStatus]);

  const topProjects = useMemo(
    () =>
      (reportData?.projects || [])
        .filter((project) => (project.totalHours ?? 0) > 0)
        .sort((a, b) => (b.totalHours ?? 0) - (a.totalHours ?? 0))
        .slice(0, 3),
    [reportData?.projects],
  );
  const activeVolunteerCount = reportData?.metrics?.totalVolunteers ?? 0;
  const verifiedHours = reportData?.metrics?.verifiedHours ?? 0;
  const pendingHours = reportData?.metrics?.pendingHours ?? 0;
  const verifiedShare =
    reportData?.metrics?.totalHours && reportData.metrics.totalHours > 0
      ? Math.round((verifiedHours / reportData.metrics.totalHours) * 100)
      : 0;

  if (loading && !reportData) {
    return (
      <div
        className="grid gap-4"
        role="status"
        aria-label="Loading organization reports"
      >
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const statValue = (value: string | number) =>
    loading ? <Skeleton className="h-7 w-14" /> : value;

  return (
    <div className="grid gap-6">
      <SectionHeader
        title="Reports"
        description="Hours, members and projects for the selected dates."
        actions={
          <>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              className="w-auto"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh report"
              onClick={loadReport}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          {
            label: "Total hours",
            value: statValue((reportData?.metrics?.totalHours ?? 0).toFixed(1)),
            helper: "Hours logged",
          },
          {
            label: "Active members",
            value: statValue(activeVolunteerCount),
            helper: "Members with hours",
          },
          {
            label: "Projects",
            value: statValue(reportData?.metrics?.totalProjects ?? 0),
            helper: "Organization projects",
          },
          {
            label: "Average per member",
            value: statValue(
              reportData?.metrics && reportData.metrics.totalVolunteers > 0
                ? (
                    (reportData.metrics.totalHours ?? 0) /
                    reportData.metrics.totalVolunteers
                  ).toFixed(1)
                : "0.0",
            ),
            helper: "Hours per active member",
          },
          {
            label: "Verified",
            value: statValue(`${verifiedShare}%`),
            helper: `${verifiedHours.toFixed(1)} verified hours`,
          },
          {
            label: "Pending",
            value: statValue(pendingHours.toFixed(1)),
            helper: "Hours awaiting review",
          },
        ]}
      />

      <ReportsCharts reportData={reportData} loading={loading} />

      <ReportsTopProjects projects={topProjects} loading={loading} />

      <ReportsSheetsStatus
        sheetStatus={sheetStatus}
        isAdmin={isAdmin}
        settingsHref={sheetsSettingsHref}
        syncing={syncingSheet}
        onSyncNow={handleSyncSheetNow}
      />
    </div>
  );
}
