"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { DateRange } from "react-day-picker";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart,
  Clock,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart as RechartsBarChart, XAxis, YAxis } from "recharts";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  exportOrganizationReport,
  getOrganizationReportData,
  type OrganizationReportData,
  type ReportType,
} from "./reports/actions";
import {
  createSheetSync,
  getSheetSyncStatus,
  syncSheetNow,
  updateSheetSyncSettings,
  updateSheetSyncConfig,
} from "./reports/sheets-actions";

type ReportsTabProps = {
  organizationId: string;
  organizationName: string;
  userRole: string | null;
};

const chartConfig = {
  verified: {
    label: "Verified",
    color: "hsl(var(--chart-1))",
  },
  pending: {
    label: "Pending",
    color: "hsl(var(--chart-3))",
  },
  attendance: {
    label: "Unpublished",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

const presetRanges = [
  { id: "fiscal", label: "This Fiscal Year" },
  { id: "last-fiscal", label: "Last Fiscal Year" },
  { id: "ytd", label: "Year to Date" },
  { id: "last-30", label: "Last 30 Days" },
  { id: "lifetime", label: "Lifetime" },
] as const;

const buildExclusiveRange = (from: Date, toInclusive: Date) => ({
  from,
  to: addDays(toInclusive, 1),
});

const getFiscalYearRange = (reference: Date, offsetYears = 0) => {
  const startYear = reference.getMonth() >= 6 ? reference.getFullYear() : reference.getFullYear() - 1;
  const from = new Date(startYear + offsetYears, 6, 1);
  const to = new Date(startYear + offsetYears + 1, 5, 30);
  return buildExclusiveRange(from, to);
};

export default function ReportsTab({ organizationId, organizationName, userRole }: ReportsTabProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [reportData, setReportData] = useState<OrganizationReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ReportType | null>(null);
  const [sheetStatus, setSheetStatus] = useState<Awaited<ReturnType<typeof getSheetSyncStatus>> | null>(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [sheetTabName, setSheetTabName] = useState("Member Hours");
  const [sheetReportType, setSheetReportType] = useState<ReportType>("member-hours");
  const isAdmin = userRole === "admin";
  const canSyncSheets = userRole === "admin" || userRole === "staff";
  const needsSheetScopes = sheetStatus?.connected && sheetStatus?.scopesOk === false;
  const connectedByLabel =
    sheetStatus?.connectedBy?.name || sheetStatus?.connectedBy?.email || null;
  const hasSyncConfig = Boolean(sheetStatus?.syncConfig);
  const canReconnect = sheetStatus?.viewerIsOwner ?? false;
  const connectUrl = `/api/calendar/google/connect?scopes=sheets&force=1&return_to=${encodeURIComponent(
    `/organization/${organizationId}`
  )}`;

  const dateRangeParam = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return undefined;
    return {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    };
  }, [dateRange]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    const result = await getOrganizationReportData(organizationId, dateRangeParam);
    if (result.error || !result.data) {
      toast.error(result.error || "Failed to load reports");
    } else {
      setReportData(result.data);
    }
    setLoading(false);
  }, [organizationId, dateRangeParam]);

  const loadSheetStatus = useCallback(async () => {
    const status = await getSheetSyncStatus(organizationId);
    setSheetStatus(status);
  }, [organizationId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    loadSheetStatus();
  }, [loadSheetStatus]);

  useEffect(() => {
    if (sheetStatus?.syncConfig) {
      setSheetTabName(sheetStatus.syncConfig.tabName || "Member Hours");
      setSheetReportType(sheetStatus.syncConfig.reportType || "member-hours");
    }
  }, [sheetStatus]);

  const applyPreset = (presetId: typeof presetRanges[number]["id"]) => {
    const now = new Date();
    if (presetId === "fiscal") {
      setDateRange(getFiscalYearRange(now));
      return;
    }
    if (presetId === "last-fiscal") {
      setDateRange(getFiscalYearRange(now, -1));
      return;
    }
    if (presetId === "ytd") {
      setDateRange(buildExclusiveRange(new Date(now.getFullYear(), 0, 1), now));
      return;
    }
    if (presetId === "last-30") {
      setDateRange(buildExclusiveRange(addDays(now, -30), now));
      return;
    }
    setDateRange(undefined);
  };

  const handleExport = async (type: ReportType) => {
    setExporting(type);
    const result = await exportOrganizationReport(organizationId, type, dateRangeParam);
    if (result.error || !result.csvData) {
      toast.error(result.error || "Export failed");
      setExporting(null);
      return;
    }

    const blob = new Blob([result.csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename || `${type}-report.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    toast.success("Export ready");
    setExporting(null);
  };

  const handleCreateSheet = async () => {
    setCreatingSheet(true);
    const result = await createSheetSync(organizationId, sheetReportType, sheetTabName);
    if (!result.success) {
      toast.error(result.error || "Failed to create sheet");
    } else {
      toast.success("Google Sheet created");
      await loadSheetStatus();
    }
    setCreatingSheet(false);
  };

  const handleSyncSheetNow = async () => {
    setSyncingSheet(true);
    const result = await syncSheetNow(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to sync sheet");
    } else {
      toast.success("Sheet synced");
      await loadSheetStatus();
    }
    setSyncingSheet(false);
  };

  const handleToggleAutoSync = async (enabled: boolean) => {
    const response = await updateSheetSyncSettings(organizationId, {
      autoSync: enabled,
      syncIntervalMinutes: sheetStatus?.syncConfig?.syncIntervalMinutes || 1440,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update sync settings");
      return;
    }

    toast.success("Sync settings updated");
    await loadSheetStatus();
  };

  const handleIntervalChange = async (value: string) => {
    const minutes = Number.parseInt(value, 10);
    if (Number.isNaN(minutes)) return;
    const response = await updateSheetSyncSettings(organizationId, {
      autoSync: sheetStatus?.syncConfig?.autoSync ?? false,
      syncIntervalMinutes: minutes,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update sync interval");
      return;
    }

    toast.success("Sync interval updated");
    await loadSheetStatus();
  };

  const handleUpdateSheetConfig = async () => {
    const response = await updateSheetSyncConfig(organizationId, {
      reportType: sheetReportType,
      tabName: sheetTabName.trim() || "Member Hours",
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update sheet config");
      return;
    }

    toast.success("Sheet config updated");
    await loadSheetStatus();
  };

  const metrics = reportData?.metrics;
  const monthlyData = reportData?.monthlyHours || [];
  const topVolunteers = reportData?.volunteers.slice(0, 5) || [];
  const topProjects = [...(reportData?.projects || [])]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Reports & Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Exportable insights for {organizationName}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            showQuickSelect={true}
            placeholder="Lifetime"
            className="w-full sm:w-auto"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={loadReport}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {presetRanges.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            onClick={() => applyPreset(preset.id)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Total Hours"
          icon={Clock}
          value={metrics?.totalHours.toFixed(1) || "0.0"}
          description="Verified + pending + attendance"
          loading={loading}
        />
        <SummaryCard
          title="Verified Hours"
          icon={BarChart}
          value={metrics?.verifiedHours.toFixed(1) || "0.0"}
          description="Certificates approved"
          loading={loading}
        />
        <SummaryCard
          title="Pending Hours"
          icon={Clock}
          value={metrics?.pendingHours.toFixed(1) || "0.0"}
          description="Awaiting verification"
          loading={loading}
        />
        <SummaryCard
          title="Volunteers"
          icon={Users}
          value={metrics?.totalVolunteers || 0}
          description="Unique volunteers"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart className="h-4 w-4 text-muted-foreground" />
              Monthly Hours Trend
            </CardTitle>
            <CardDescription>Verified, pending, and unpublished hours</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : monthlyData.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                No hours recorded for this period.
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <RechartsBarChart data={monthlyData} margin={{ left: 0, right: 16 }}>
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="verified" stackId="a" fill="var(--color-verified)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pending" stackId="a" fill="var(--color-pending)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="attendance" stackId="a" fill="var(--color-attendance)" radius={[4, 4, 0, 0]} />
                </RechartsBarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Top Volunteers
            </CardTitle>
            <CardDescription>Highest total hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : topVolunteers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No volunteer activity yet.</div>
            ) : (
              topVolunteers.map((volunteer) => (
                <div key={volunteer.key} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{volunteer.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {volunteer.email || "No email"}
                    </p>
                  </div>
                  <Badge variant="secondary">{volunteer.totalHours.toFixed(1)}h</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              Export Reports
            </CardTitle>
            <CardDescription>Download CSV summaries for officers meetings</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ExportButton
              label="Member Hours Summary"
              type="member-hours"
              exporting={exporting}
              onExport={handleExport}
            />
            <ExportButton
              label="Project Summary"
              type="project-summary"
              exporting={exporting}
              onExport={handleExport}
            />
            <ExportButton
              label="Monthly Hours Breakdown"
              type="monthly-summary"
              exporting={exporting}
              onExport={handleExport}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Image
                src="/googlesheets.svg"
                alt="Google Sheets"
                width={16}
                height={16}
              />
              Google Sheets Sync
            </CardTitle>
            <CardDescription>Sync reports to a live spreadsheet</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!sheetStatus?.connected ? (
              <div className="space-y-3">
                {hasSyncConfig ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      This organization already has a linked Google Sheet.
                      {connectedByLabel ? ` Connected by ${connectedByLabel}.` : ""}
                    </p>
                    {canReconnect ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          window.location.href = connectUrl;
                        }}
                      >
                        Reconnect Google Sheets
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Ask the sheet owner to reconnect their Google account.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connect Google Sheets to create and sync organization reports.
                    </p>
                    {isAdmin ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          window.location.href = connectUrl;
                        }}
                      >
                        Connect Google Sheets
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        An admin needs to connect Google Sheets to enable syncs.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Connected</p>
                    <p className="text-xs text-muted-foreground">
                      {sheetStatus.connectedEmail || "Google account"}
                    </p>
                  </div>
                  <Badge variant="secondary">Google</Badge>
                </div>

                {sheetStatus.syncConfig && connectedByLabel && (
                  <p className="text-[11px] text-muted-foreground">
                    Connected by {connectedByLabel}
                  </p>
                )}

                {needsSheetScopes && (
                  <div className="rounded-md border border-amber-200/70 bg-amber-50/60 p-3 text-xs text-amber-900">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Sheets permissions required
                    </div>
                    <p className="mt-1">
                      Reconnect Google with Sheets access to keep report syncs working.
                    </p>
                    {canReconnect ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => {
                          window.location.href = connectUrl;
                        }}
                      >
                        Reconnect with Sheets Access
                      </Button>
                    ) : (
                      <p className="mt-2 text-[11px] text-amber-900/80">
                        Ask the sheet owner to reconnect the Google account.
                      </p>
                    )}
                  </div>
                )}

                {sheetStatus.error && (
                  <p className="text-xs text-muted-foreground">
                    {sheetStatus.error}
                  </p>
                )}

                {sheetStatus.syncConfig ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Linked Sheet</p>
                        <a
                          href={sheetStatus.syncConfig.sheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline"
                        >
                          Open Sheet
                        </a>
                        {sheetStatus.syncConfig.lastSyncedAt && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Last synced {format(new Date(sheetStatus.syncConfig.lastSyncedAt), "MMM d, yyyy h:mm a")}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSyncSheetNow}
                        disabled={!canSyncSheets || syncingSheet || needsSheetScopes}
                      >
                        {syncingSheet ? "Syncing..." : "Sync Now"}
                      </Button>
                    </div>
                    {isAdmin ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Report Type</p>
                          <Select
                            value={sheetReportType}
                            onValueChange={(value) => setSheetReportType(value as ReportType)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select report" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member-hours">Member Hours Summary</SelectItem>
                              <SelectItem value="project-summary">Project Summary</SelectItem>
                              <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium">Sheet Tab Name</p>
                          <Input
                            value={sheetTabName}
                            onChange={(event) => setSheetTabName(event.target.value)}
                            placeholder="Member Hours"
                          />
                        </div>

                        <Button variant="outline" size="sm" onClick={handleUpdateSheetConfig}>
                          Update Sheet Config
                        </Button>

                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">Auto Sync</p>
                            <p className="text-xs text-muted-foreground">
                              Run background refresh jobs
                            </p>
                          </div>
                          <Switch
                            checked={sheetStatus.syncConfig.autoSync}
                            onCheckedChange={handleToggleAutoSync}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">Sync Interval</p>
                            <p className="text-xs text-muted-foreground">How often to refresh</p>
                          </div>
                          <Select
                            value={String(sheetStatus.syncConfig.syncIntervalMinutes)}
                            onValueChange={handleIntervalChange}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue placeholder="Interval" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="360">Every 6 hours</SelectItem>
                              <SelectItem value="720">Every 12 hours</SelectItem>
                              <SelectItem value="1440">Daily</SelectItem>
                              <SelectItem value="4320">Every 3 days</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Report type: {sheetStatus.syncConfig.reportType}</p>
                        <p>Sheet tab: {sheetStatus.syncConfig.tabName || "Member Hours"}</p>
                        <p>Auto sync: {sheetStatus.syncConfig.autoSync ? "On" : "Off"}</p>
                        <p>
                          Interval: {sheetStatus.syncConfig.syncIntervalMinutes} minutes
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Create a sheet to sync member hours.
                    </p>
                    {isAdmin ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Report Type</p>
                          <Select
                            value={sheetReportType}
                            onValueChange={(value) => setSheetReportType(value as ReportType)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select report" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member-hours">Member Hours Summary</SelectItem>
                              <SelectItem value="project-summary">Project Summary</SelectItem>
                              <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Sheet Tab Name</p>
                          <Input
                            value={sheetTabName}
                            onChange={(event) => setSheetTabName(event.target.value)}
                            placeholder="Member Hours"
                          />
                        </div>
                        <Button
                          onClick={handleCreateSheet}
                          disabled={creatingSheet}
                        >
                          {creatingSheet ? "Creating..." : "Create Sheet"}
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        An admin needs to create the Google Sheet before syncs can run.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart className="h-4 w-4 text-muted-foreground" />
            Projects with Most Hours
          </CardTitle>
          <CardDescription>Top projects by total hours logged</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : topProjects.length === 0 ? (
            <div className="text-sm text-muted-foreground">No project hours yet.</div>
          ) : (
            <div className="space-y-3">
              {topProjects.map((project) => (
                <div key={project.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{project.title}</p>
                    <p className="text-xs text-muted-foreground">{project.status || "Unknown"}</p>
                  </div>
                  <Badge variant="secondary">{project.totalHours.toFixed(1)}h</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="mt-2 h-6 w-16" />
            ) : (
              <div className="text-xl font-semibold mt-1">{value}</div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
          </div>
          <div className="p-2 rounded-md bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExportButton({
  label,
  type,
  exporting,
  onExport,
}: {
  label: string;
  type: ReportType;
  exporting: ReportType | null;
  onExport: (type: ReportType) => void;
}) {
  const isLoading = exporting === type;
  return (
    <Button
      variant="outline"
      onClick={() => onExport(type)}
      disabled={isLoading}
      className="justify-between"
    >
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {isLoading ? "Exporting..." : "CSV"}
        <Download className="h-4 w-4" />
      </span>
    </Button>
  );
}