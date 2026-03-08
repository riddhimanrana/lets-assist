"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { DateRange } from "react-day-picker";
import { addDays, endOfDay, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";
import {
  BarChart,
  Clock,
  Download,
  FileSpreadsheet,
  FolderKanban,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart as RechartsBarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import {
  exportOrganizationReport,
  getOrganizationReportData,
  type OrganizationReportData,
  type ReportType,
} from "./reports/actions";
import { ReportLayoutCustomizer } from "./reports/ReportLayoutCustomizer";
import {
  getDefaultLayout,
  type ReportLayoutConfig,
} from "./reports/report-layouts";
import {
  createSheetSync,
  connectExistingSheet,
  getAvailableSheetOwners,
  getSheetReportPreview,
  getSheetsAccessTokenForPicker,
  getSpreadsheetSetupMetadata,
  getSheetSyncStatus,
  unlinkSheetSync,
  updateSheetOwner,
  syncSheetNow,
  updateSheetSyncSettings,
  updateSheetSyncConfig,
} from "./reports/sheets-actions";

type ReportsTabProps = {
  organizationId: string;
  organizationSlug?: string;
  organizationName: string;
  userRole: string | null;
};

type PickerCallbackData = {
  action: string;
  docs?: Array<{ id?: string }>;
};

type GooglePickerView = {
  setMimeTypes: (types: string) => void;
  setOwnedByMe?: (ownedByMe: boolean) => void;
  setEnableDrives?: (enabled: boolean) => void;
  setIncludeFolders?: (enabled: boolean) => void;
};

type GooglePickerBuilder = {
  setTitle: (title: string) => GooglePickerBuilder;
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setCallback: (callback: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

type GooglePickerNamespace = {
  picker: {
    ViewId: { SPREADSHEETS: string };
    Action: { PICKED: string };
    DocsView: new (viewId: string) => GooglePickerView;
    PickerBuilder: new () => GooglePickerBuilder;
  };
};

type GoogleApiWindow = Window & {
  gapi?: { load: (name: string, options: { callback: () => void }) => void };
  google?: GooglePickerNamespace;
};

const presetRanges = [
  { id: "fiscal", label: "This Fiscal Year" },
  { id: "last-fiscal", label: "Last Fiscal Year" },
  { id: "ytd", label: "Year to Date" },
  { id: "last-30", label: "Last 30 Days" },
  { id: "lifetime", label: "Lifetime" },
] as const;

const reportTypeLabels: Record<ReportType, string> = {
  "member-hours": "Member Hours Summary",
  "project-summary": "Project Summary",
  "monthly-summary": "Monthly Hours",
};

const rangeModeLabels: Record<"full" | "custom", string> = {
  full: "Full tab (A1)",
  custom: "Custom range",
};

const syncIntervalOptions = [
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "4320", label: "Every 3 days" },
] as const;

const getSyncIntervalLabel = (value: string | number | null | undefined) => {
  const normalized = String(value ?? "");
  return (
    syncIntervalOptions.find((option) => option.value === normalized)?.label ||
    (normalized ? `Every ${normalized} minutes` : "Interval")
  );
};

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

export default function ReportsTab({ 
  organizationId, 
  organizationSlug,
  organizationName, 
  userRole 
}: ReportsTabProps) {
  const searchParams = useSearchParams();
  const chartConfig = useMemo(() => ({
    total: {
      label: "Hours",
      color: "var(--chart-3)",
    },
  } satisfies ChartConfig), []);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonth(subMonths(new Date(), 11)),
    to: new Date(),
  }));
  const [reportData, setReportData] = useState<OrganizationReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ReportType | null>(null);
  const [sheetStatus, setSheetStatus] = useState<Awaited<ReturnType<typeof getSheetSyncStatus>> | null>(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [sheetTabName, setSheetTabName] = useState("Member Hours");
  const [sheetReportType, setSheetReportType] = useState<ReportType>("member-hours");
  const [rangeMode, setRangeMode] = useState<"full" | "custom">("full");
  const [rangeStartColumn, setRangeStartColumn] = useState("A");
  const [rangeStartRow, setRangeStartRow] = useState("1");
  const [rangeEndColumn, setRangeEndColumn] = useState("H");
  const [rangeEndRow, setRangeEndRow] = useState("20");
  const [layoutConfig, setLayoutConfig] = useState<ReportLayoutConfig | null>(null);
  const [setupMode, setSetupMode] = useState<"create" | "existing">("create");
  const [sheetInput, setSheetInput] = useState("");
  const [sheetMetadata, setSheetMetadata] = useState<{
    sheetId: string;
    sheetTitle: string;
    sheetUrl: string;
    tabs: string[];
  } | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [connectingSheet, setConnectingSheet] = useState(false);
  const [unlinkingSheet, setUnlinkingSheet] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [unlinkIntent, setUnlinkIntent] = useState<"unlink" | "switch">("unlink");
  const [sheetConfigSections, setSheetConfigSections] = useState<string[]>([]);
  const [availableOwners, setAvailableOwners] = useState<
    Array<{
      id: string;
      name: string | null;
      email: string | null;
      role: string | null;
      connectedEmail: string | null;
      hasSheetsAccess: boolean;
    }>
  >([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [updatingOwner, setUpdatingOwner] = useState(false);
  const sheetConfigRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (searchParams.get("setup") === "1" && sheetStatus?.connected) {
      requestAnimationFrame(() => {
        sheetConfigRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [searchParams, sheetStatus?.connected]);

  const isAdmin = userRole === "admin";
  const canSyncSheets = isAdmin;
  const viewerConnected = sheetStatus?.viewerConnected ?? false;
  const viewerScopesOk = sheetStatus?.viewerScopesOk ?? false;
  const viewerNeedsSheets = isAdmin && viewerConnected && !viewerScopesOk;
  const viewerMissingConnection = isAdmin && !viewerConnected;
  const ownerNeedsSheets = sheetStatus?.connected && sheetStatus?.scopesOk === false;
  const needsSheetScopes = viewerNeedsSheets || ownerNeedsSheets;
  const connectedByLabel =
    sheetStatus?.connectedBy?.name || sheetStatus?.connectedBy?.email || null;
  const hasSheetOwner = Boolean(sheetStatus?.connectedBy);
  const hasSyncConfig = Boolean(sheetStatus?.syncConfig);
  const canReconnect = isAdmin; // Any admin can reconnect/take over a broken or existing sync
  const orgSlugOrId = organizationSlug || organizationId;
  const connectUrl = `/api/calendar/google/connect?scopes=sheets&sheets_sync=1&force=1&org_id=${organizationId}&return_to=${encodeURIComponent(
    `/organization/${orgSlugOrId}?tab=reports`
  )}`;
  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  const setupBlockedReason = viewerMissingConnection
    ? "Connect your Google account to set up Sheets sync."
    : viewerNeedsSheets
      ? "Sheets permissions are missing. Reconnect with Sheets access to continue."
      : null;
  const managedByAnotherAdmin = Boolean(
    sheetStatus?.syncConfig && hasSheetOwner && !sheetStatus?.viewerIsOwner
  );

  const columnOptions = useMemo(
    () => Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
    []
  );

  const rangeA1 = useMemo(() => {
    if (rangeMode === "full") {
      return "A1";
    }
    const startRow = rangeStartRow || "1";
    const endRow = rangeEndRow || startRow;
    return `${rangeStartColumn}${startRow}:${rangeEndColumn}${endRow}`;
  }, [rangeMode, rangeStartColumn, rangeStartRow, rangeEndColumn, rangeEndRow]);

  const selectedOwner = useMemo(
    () => availableOwners.find((owner) => owner.id === selectedOwnerId) || null,
    [availableOwners, selectedOwnerId]
  );

  const dateRangeParam = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return undefined;
    return {
      from: startOfDay(dateRange.from).toISOString(),
      to: endOfDay(dateRange.to).toISOString(),
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

  const handleUpdateSheetConfig = useCallback(async () => {
    if (!sheetStatus?.syncConfig) return;
    const result = await updateSheetSyncConfig(organizationId, {
      tabName: sheetTabName,
      reportType: sheetReportType,
      rangeA1,
      layoutConfig,
    });
    if (result.success) {
      toast.success("Sync configuration updated");
      handleLoadSheetStatus();
    } else {
      toast.error(result.error || "Failed to update configuration");
    }
  }, [organizationId, sheetTabName, sheetReportType, rangeA1, layoutConfig, sheetStatus?.syncConfig, handleLoadSheetStatus]);

  const handlePreviewReport = useCallback(async () => {
    setPreviewLoading(true);
    const result = await getSheetReportPreview(organizationId, sheetReportType, 12, layoutConfig);
    if (result.error || !result.rows) {
      toast.error(result.error || "Failed to generate preview");
    } else {
      setPreviewRows(result.rows);
      setPreviewRequested(true);
    }
    setPreviewLoading(false);
  }, [organizationId, sheetReportType, layoutConfig]);

  const handleCreateSheet = useCallback(async () => {
    setCreatingSheet(true);
    const result = await createSheetSync(organizationId, sheetReportType, sheetTabName, rangeA1, layoutConfig);
    if (result.success) {
      toast.success("Sheet created successfully");
      handleLoadSheetStatus();
    } else {
      setSetupError(result.error || "Failed to create sheet");
    }
    setCreatingSheet(false);
  }, [organizationId, sheetReportType, sheetTabName, rangeA1, layoutConfig, handleLoadSheetStatus]);

  const handleUpdateOwner = useCallback(async () => {
    if (!selectedOwnerId) return;
    setUpdatingOwner(true);
    const result = await updateSheetOwner(organizationId, selectedOwnerId);
    if (result.success) {
      toast.success("Sheet owner updated");
      handleLoadSheetStatus();
    } else {
      toast.error(result.error || "Failed to update owner");
    }
    setUpdatingOwner(false);
  }, [organizationId, selectedOwnerId, handleLoadSheetStatus]);

  const handleToggleAutoSync = useCallback(async (checked: boolean) => {
    const result = await updateSheetSyncSettings(organizationId, { autoSync: checked });
    if (result.success) {
      handleLoadSheetStatus();
    } else {
      toast.error(result.error || "Failed to update auto-sync");
    }
  }, [organizationId, handleLoadSheetStatus]);

  const handleIntervalChange = useCallback(async (val: string) => {
    const result = await updateSheetSyncSettings(organizationId, { syncIntervalMinutes: parseInt(val, 10) });
    if (result.success) {
      handleLoadSheetStatus();
    } else {
      toast.error(result.error || "Failed to update interval");
    }
  }, [organizationId, handleLoadSheetStatus]);

  const handleConfirmUnlinkSheet = useCallback(async () => {
    setUnlinkingSheet(true);

    const result = await unlinkSheetSync(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to unlink sheet");
      setUnlinkingSheet(false);
      return;
    }

    toast.success(
      unlinkIntent === "switch"
        ? "Current sheet unlinked. Set up a new destination below."
        : "Spreadsheet disconnected"
    );

    setSetupError(null);
    setSheetMetadata(null);
    await handleLoadSheetStatus();

    if (unlinkIntent === "switch") {
      setSheetConfigSections(["destination"]);
      requestAnimationFrame(() => {
        sheetConfigRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    setUnlinkingSheet(false);
    setShowUnlinkDialog(false);
  }, [organizationId, unlinkIntent, handleLoadSheetStatus]);

  const handleLoadSheetMetadata = useCallback(async () => {
    if (!sheetInput.trim()) return;
    setPickerLoading(true);
    const result = await getSpreadsheetSetupMetadata(organizationId, sheetInput.trim());
    if (!result.success || result.error) {
      setSheetMetadata(null);
      setSetupError(result.error ?? null);
    } else if (result.metadata) {
      setSheetMetadata(result.metadata);
      setSetupError(null);
    }
    setPickerLoading(false);
  }, [organizationId, sheetInput]);

  const handleSetupModeChange = (mode: "create" | "existing") => {
    setSetupMode(mode);
    setSetupError(null);
    setSheetMetadata(null);
    setSheetInput("");
  };

  const handleConnectExistingSheet = useCallback(async () => {
    if (!sheetMetadata) return;
    setConnectingSheet(true);
    const result = await connectExistingSheet(
      organizationId,
      {
        sheetId: sheetMetadata.sheetId,
        reportType: sheetReportType,
        tabName: sheetTabName,
        rangeA1,
        layoutConfig
      }
    );
    if (result.success) {
      toast.success("Sheet connected successfully");
      handleLoadSheetStatus();
    } else {
      setSetupError(result.error || "Failed to connect sheet");
    }
    setConnectingSheet(false);
  }, [organizationId, sheetMetadata, sheetReportType, sheetTabName, rangeA1, layoutConfig, handleLoadSheetStatus]);

  const loadGoogleApi = useCallback(() => {
    const win = window as any as GoogleApiWindow;
    if (win.gapi?.load) return Promise.resolve(true);

    return new Promise<boolean>((resolve, reject) => {
      const existing = document.querySelector('script[data-google-picker="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(true));
        existing.addEventListener("error", () => reject(new Error("Failed to load Google API")));
        return;
      }

      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.defer = true;
      script.dataset.googlePicker = "true";
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error("Failed to load Google API"));
      document.body.appendChild(script);
    });
  }, []);

  const initPicker = useCallback(async () => {
    const win = window as any as GoogleApiWindow;
    if (win.google?.picker) {
      setPickerReady(true);
      return true;
    }

    try {
      await loadGoogleApi();
    } catch (err) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      win.gapi?.load("picker", {
        callback: () => {
          setPickerReady(true);
          resolve(true);
        },
      });
    });
  }, [loadGoogleApi]);

  const handleOpenPicker = useCallback(async () => {
    setPickerLoading(true);
    setSetupError(null);

    try {
      const tokenResult = await getSheetsAccessTokenForPicker(organizationId);
      if (!tokenResult.success || tokenResult.error || !tokenResult.accessToken) {
        setSetupError(
          tokenResult.error ||
            "Unable to open Google Picker. Please reconnect with Sheets access and try again."
        );
        return;
      }

      if (!pickerApiKey) {
        setSetupError("Google Picker is not configured. Missing NEXT_PUBLIC_GOOGLE_PICKER_API_KEY.");
        return;
      }

      if (!(await initPicker())) {
        setSetupError("Unable to load Google Picker library.");
        return;
      }

      const win = window as any as GoogleApiWindow;
      const google = win.google;
      if (!google?.picker) {
        setSetupError("Google Picker is not available.");
        return;
      }

      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");

      const picker = new google.picker.PickerBuilder()
        .setTitle("Select a Google Sheet")
        .addView(view)
        .setOAuthToken(tokenResult.accessToken)
        .setDeveloperKey(pickerApiKey)
        .setCallback(async (data: PickerCallbackData) => {
          if (data.action !== google.picker.Action.PICKED) {
            return;
          }

          const doc = data.docs?.[0];
          if (!doc?.id) {
            return;
          }

          setSheetInput(doc.id);

          try {
            const metadataResult = await getSpreadsheetSetupMetadata(organizationId, doc.id);
            if (!metadataResult.success || metadataResult.error || !metadataResult.metadata) {
              setSheetMetadata(null);
              setSetupError(metadataResult.error || "Unable to load selected spreadsheet metadata.");
              return;
            }

            setSetupError(null);
            setSheetMetadata(metadataResult.metadata);
          } catch {
            setSheetMetadata(null);
            setSetupError("Unable to load selected spreadsheet metadata.");
          }
        })
        .build();

      picker.setVisible(true);
    } finally {
      setPickerLoading(false);
    }
  }, [organizationId, initPicker, pickerApiKey]);

  useEffect(() => {
    loadReport();
    handleLoadSheetStatus();
  }, [loadReport, handleLoadSheetStatus]);

  useEffect(() => {
    if (isAdmin) {
      setOwnersLoading(true);
      getAvailableSheetOwners(organizationId).then((result) => {
        if (result.success) {
          setAvailableOwners(result.owners);
          if (sheetStatus?.connectedBy?.id) {
            setSelectedOwnerId(sheetStatus.connectedBy.id);
          }
        }
        setOwnersLoading(false);
      });
    }
  }, [isAdmin, organizationId, sheetStatus?.connectedBy?.id]);

  const topProjects = useMemo(
    () => (reportData?.projects || [])
      .filter((project) => (project.totalHours ?? 0) > 0)
      .sort((a, b) => (b.totalHours ?? 0) - (a.totalHours ?? 0))
      .slice(0, 3),
    [reportData?.projects]
  );
  const monthlyData = reportData?.monthlyHours || [];

  if (loading && !reportData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Organization Reports</h2>
          <p className="text-muted-foreground">
            View impact metrics and sync data to Google Sheets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={loadReport}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Hours"
          value={(reportData?.metrics?.totalHours ?? 0).toFixed(1)}
          description="Total hours logged"
          icon={Clock}
          loading={loading}
        />
        <SummaryCard
          title="Active Members"
          value={reportData?.metrics?.totalVolunteers ?? 0}
          description="Members with hours"
          icon={Users}
          loading={loading}
        />
        <SummaryCard
          title="Projects"
          value={reportData?.metrics?.totalProjects ?? 0}
          description="Organization projects"
          icon={FolderKanban}
          loading={loading}
        />
        <SummaryCard
          title="Avg Per Active Member"
          value={
            reportData?.metrics && reportData.metrics.totalVolunteers > 0
              ? ((reportData.metrics.totalHours ?? 0) / reportData.metrics.totalVolunteers).toFixed(1)
              : "0.0"
          }
          description="Average hours per active member"
          icon={BarChart}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Monthly Hours Breakdown
          </CardTitle>
          <CardDescription>Hours logged month by month for the selected range</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-50 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-50 w-full">
              <RechartsBarChart accessibilityLayer data={monthlyData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tick={{ fontSize: 10 }}
                />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="total"
                  fill="var(--color-total)"
                  radius={[4, 4, 0, 0]}
                />
              </RechartsBarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            Google Sheets Sync
          </CardTitle>
          <CardDescription>
            Automatically sync report data to a Google Sheet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
                Google Sheets sync is managed by organization admins.
              </div>
            ) : (
              <>
                {!sheetStatus?.connected ? (
                  <div className="space-y-3 rounded-xl border border-dashed border-border/60 bg-muted/40 p-4">
                    {hasSyncConfig ? (
                      <>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Sheets connection needed
                        </p>
                        <p className="text-sm text-muted-foreground">
                          This organization already has a linked Google Sheet.
                          {connectedByLabel ? ` Connected by ${connectedByLabel}.` : ""}
                        </p>
                        {canReconnect ? (
                          <div className="space-y-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                window.location.href = connectUrl;
                              }}
                            >
                              {sheetStatus?.viewerIsOwner ? "Reconnect Google Sheets" : "Connect & Take Over Sync"}
                            </Button>
                            {!sheetStatus?.viewerIsOwner && (
                              <p className="text-[10px] text-muted-foreground italic">
                                You can take over the sync responsibility for this organization.
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Ask the sheet owner to reconnect their Google account.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Connect to start syncing
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Connect Google Sheets to create and sync organization reports.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            window.location.href = connectUrl;
                          }}
                        >
                          Connect Google Sheets
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Google Sheets connected</p>
                        <p className="text-xs text-muted-foreground">
                          {sheetStatus.connectedEmail || "Google account"}
                        </p>
                        {sheetStatus.syncConfig?.sheetTitle && (
                          <p className="text-xs text-muted-foreground">
                            Sheet: {sheetStatus.syncConfig.sheetTitle}
                          </p>
                        )}
                        {sheetStatus.syncConfig?.lastSyncedAt && (
                          <p className="text-[11px] text-muted-foreground">
                            Last synced {format(new Date(sheetStatus.syncConfig.lastSyncedAt), "MMM d, yyyy h:mm a")}
                          </p>
                        )}
                        {sheetStatus.syncConfig && connectedByLabel && (
                          <p className="text-[11px] text-muted-foreground">Connected by {connectedByLabel}</p>
                        )}
                        {managedByAnotherAdmin && (
                          <p className="text-[11px] text-muted-foreground">
                            This sync is managed by another admin. Ask them to disconnect it, or connect your Google account with Sheets access to take over.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {sheetStatus.syncConfig?.sheetUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                          >
                            <a
                              href={sheetStatus.syncConfig.sheetUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open sheet
                            </a>
                          </Button>
                        )}
                        {sheetStatus.syncConfig && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSyncSheetNow}
                            disabled={!canSyncSheets || syncingSheet || ownerNeedsSheets}
                          >
                            {syncingSheet ? "Syncing..." : "Sync now"}
                          </Button>
                        )}
                        {managedByAnotherAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              window.location.href = connectUrl;
                            }}
                          >
                            {viewerConnected && viewerScopesOk
                              ? "Take over with my Google account"
                              : viewerMissingConnection
                                ? "Connect & Take Over Sync"
                                : "Reconnect & Take Over Sync"}
                          </Button>
                        )}
                        {sheetStatus.syncConfig && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSheetConfigSections(["destination"]);
                              requestAnimationFrame(() => {
                                sheetConfigRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              });
                            }}
                          >
                            Configure
                          </Button>
                        )}
                        {sheetStatus.syncConfig && (
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={unlinkingSheet || !sheetStatus.viewerIsOwner}
                            onClick={() => {
                              setUnlinkIntent("unlink");
                              setShowUnlinkDialog(true);
                            }}
                          >
                            Disconnect
                          </Button>
                        )}
                      </div>
                    </div>
                    {ownerNeedsSheets && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                        Sheets permissions are missing for the connected account. Reconnect to restore syncing.
                      </div>
                    )}
                    {sheetStatus.error && (
                      <p className="text-xs text-muted-foreground">{sheetStatus.error}</p>
                    )}
                    {!sheetStatus.syncConfig && (
                      <p className="text-xs text-muted-foreground">
                        No sheet destination is configured yet. Complete setup below.
                      </p>
                    )}
                  </div>
                )}

                {sheetStatus?.connected && (
                  <div id="sheet-config" ref={sheetConfigRef} className="space-y-4">
                    {sheetStatus.syncConfig ? (
                      <div className="space-y-4">
                        <Accordion
                          value={sheetConfigSections}
                          onValueChange={(val) => val && setSheetConfigSections(val)}
                        >
                          <AccordionItem value="destination">
                            <AccordionTrigger className="text-sm font-semibold">
                              Destination
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">Report Type</p>
                                  <Select
                                    value={sheetReportType}
                                    onValueChange={(value) => setSheetReportType(value as ReportType)}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select report">
                                        {reportTypeLabels[sheetReportType]}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="member-hours">Member Hours Summary</SelectItem>
                                        <SelectItem value="project-summary">Project Summary</SelectItem>
                                        <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
                                      </SelectGroup>
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

                                <div className="md:col-span-2 space-y-2">
                                  <p className="text-sm font-medium">Range</p>
                                  <RangeBuilder
                                    columns={columnOptions}
                                    mode={rangeMode}
                                    onModeChange={setRangeMode}
                                    startColumn={rangeStartColumn}
                                    startRow={rangeStartRow}
                                    endColumn={rangeEndColumn}
                                    endRow={rangeEndRow}
                                    onStartColumnChange={setRangeStartColumn}
                                    onStartRowChange={setRangeStartRow}
                                    onEndColumnChange={setRangeEndColumn}
                                    onEndRowChange={setRangeEndRow}
                                    helperText="Use this as the top-left anchor. Data expands to fit the report columns."
                                  />
                                  {sheetStatus.syncConfig.sheetUrl && (
                                    <a
                                      href={sheetStatus.syncConfig.sheetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] text-primary underline underline-offset-4"
                                    >
                                      Open the sheet to pick a range
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={handleUpdateSheetConfig}>
                                  Save destination changes
                                </Button>
                              </div>
                            </AccordionContent>
                          </AccordionItem>

                          <AccordionItem value="layout">
                            <AccordionTrigger className="text-sm font-semibold">
                              Layout & preview
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3">
                              <ReportLayoutCustomizer
                                reportType={sheetReportType}
                                currentLayout={layoutConfig}
                                onLayoutChange={(config) => setLayoutConfig(config)}
                                isLoading={previewLoading}
                                onReset={() => setPreviewRows(null)}
                              />

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handlePreviewReport}
                                  disabled={previewLoading}
                                >
                                  {previewLoading ? "Loading preview..." : "Preview data"}
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleUpdateSheetConfig}>
                                  Update layout
                                </Button>
                              </div>

                              {previewRows && (
                                <div className="space-y-3">
                                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">
                                      Preview (first {Math.max(previewRows.length - 1, 0)} rows)
                                    </p>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-xs">
                                        <thead className="bg-muted/50">
                                          <tr>
                                            {previewRows[0]?.map((cell, index) => (
                                              <th
                                                key={index}
                                                className="px-2 py-1 text-left font-medium text-muted-foreground"
                                              >
                                                {cell}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {previewRows.slice(1).map((row, rowIndex) => (
                                            <tr key={rowIndex} className="border-t">
                                              {row.map((cell, cellIndex) => (
                                                <td key={cellIndex} className="px-2 py-1 text-muted-foreground">
                                                  {cell || "-"}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                  <MiniSheetPreview
                                    rangeA1={rangeA1}
                                    previewRows={previewRows}
                                    columns={columnOptions}
                                  />
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>

                          <AccordionItem value="automation">
                            <AccordionTrigger className="text-sm font-semibold">
                              Owner & automation
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Sheet Owner</p>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Select
                                    value={selectedOwnerId ?? ""}
                                    onValueChange={(value) => setSelectedOwnerId(value || null)}
                                    disabled={ownersLoading}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select owner" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {ownersLoading && (
                                          <SelectItem value="loading" disabled>
                                            Loading connected members...
                                          </SelectItem>
                                        )}
                                        {!ownersLoading && availableOwners.length === 0 && (
                                          <SelectItem value="none" disabled>
                                            No connected admins found
                                          </SelectItem>
                                        )}
                                        {availableOwners.map((owner) => (
                                          <SelectItem key={owner.id} value={owner.id}>
                                            {owner.name || owner.email || "Member"}
                                            {owner.connectedEmail ? ` • ${owner.connectedEmail}` : ""}
                                            {owner.hasSheetsAccess ? "" : " (needs Sheets access)"}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    variant="outline"
                                    onClick={handleUpdateOwner}
                                    disabled={updatingOwner || !selectedOwnerId}
                                  >
                                    {updatingOwner ? "Updating..." : "Update owner"}
                                  </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                  The owner account supplies Sheets credentials for sync jobs.
                                </p>
                                {selectedOwner && !selectedOwner.hasSheetsAccess && (
                                  <p className="text-[11px] text-destructive">
                                    This admin must reconnect Google with Sheets access before becoming the owner.
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">Auto Sync</p>
                                  <p className="text-xs text-muted-foreground">Run background refresh jobs</p>
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
                                  onValueChange={(val) => val && handleIntervalChange(val)}
                                >
                                  <SelectTrigger className="w-35">
                                    <SelectValue placeholder="Interval">
                                      {getSyncIntervalLabel(sheetStatus.syncConfig.syncIntervalMinutes)}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {syncIntervalOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="flex flex-col gap-2 sm:flex-row">
                                {sheetStatus.viewerIsOwner ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={unlinkingSheet}
                                      onClick={() => {
                                        setUnlinkIntent("switch");
                                        setShowUnlinkDialog(true);
                                      }}
                                    >
                                      Switch sheet
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      disabled={unlinkingSheet}
                                      onClick={() => {
                                        setUnlinkIntent("unlink");
                                        setShowUnlinkDialog(true);
                                      }}
                                    >
                                      Unlink sheet
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs text-muted-foreground">
                                      Only the connected owner can disconnect this sync directly.
                                    </p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        window.location.href = connectUrl;
                                      }}
                                    >
                                      {viewerConnected && viewerScopesOk
                                        ? "Take over with my Google account"
                                        : viewerMissingConnection
                                          ? "Connect & Take Over Sync"
                                          : "Reconnect & Take Over Sync"}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    ) : (
                      <div className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-4">
                        <p className="text-sm text-muted-foreground">
                          Set up a Google Sheet to sync organization reports.
                        </p>
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
                          <span className="font-medium text-primary">Only admins can manage Sheets sync.</span>
                          <span className="text-muted-foreground"> Connect with Sheets permissions to continue.</span>
                        </div>
                        {setupBlockedReason && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                            {setupBlockedReason}
                            <div className="mt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  window.location.href = connectUrl;
                                }}
                              >
                                {viewerMissingConnection ? "Connect Google Sheets" : "Reconnect with Sheets access"}
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="space-y-4">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                              variant={setupMode === "create" ? "default" : "outline"}
                              onClick={() => handleSetupModeChange("create")}
                              disabled={Boolean(setupBlockedReason)}
                            >
                              Create new sheet
                            </Button>
                            <Button
                              variant={setupMode === "existing" ? "default" : "outline"}
                              onClick={() => handleSetupModeChange("existing")}
                              disabled={Boolean(setupBlockedReason)}
                            >
                              Connect existing sheet
                            </Button>
                          </div>

                          {setupMode === "create" ? (
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Report Type</p>
                                <Select
                                  value={sheetReportType}
                                  onValueChange={(value) => setSheetReportType(value as ReportType)}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select report">
                                      {reportTypeLabels[sheetReportType]}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="member-hours">Member Hours Summary</SelectItem>
                                      <SelectItem value="project-summary">Project Summary</SelectItem>
                                      <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
                                    </SelectGroup>
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
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Range</p>
                                <RangeBuilder
                                  columns={columnOptions}
                                  mode={rangeMode}
                                  onModeChange={setRangeMode}
                                  startColumn={rangeStartColumn}
                                  startRow={rangeStartRow}
                                  endColumn={rangeEndColumn}
                                  endRow={rangeEndRow}
                                  onStartColumnChange={setRangeStartColumn}
                                  onStartRowChange={setRangeStartRow}
                                  onEndColumnChange={setRangeEndColumn}
                                  onEndRowChange={setRangeEndRow}
                                  helperText="Pick the top-left anchor. The report will expand to fit the data."
                                />
                              </div>

                              <Accordion>
                                <AccordionItem value="layout">
                                  <AccordionTrigger className="text-sm font-semibold">
                                    Layout & preview
                                  </AccordionTrigger>
                                  <AccordionContent className="space-y-3">
                                    <ReportLayoutCustomizer
                                      reportType={sheetReportType}
                                      currentLayout={layoutConfig}
                                      onLayoutChange={(config) => setLayoutConfig(config)}
                                      isLoading={previewLoading}
                                      onReset={() => setPreviewRows(null)}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handlePreviewReport}
                                        disabled={previewLoading || Boolean(setupBlockedReason)}
                                      >
                                        {previewLoading ? "Loading preview..." : "Preview data"}
                                      </Button>
                                      <Button
                                        onClick={handleCreateSheet}
                                        disabled={creatingSheet || Boolean(setupBlockedReason)}
                                      >
                                        {creatingSheet ? "Creating..." : "Create Sheet"}
                                      </Button>
                                    </div>
                                    {previewRows && (
                                      <div className="space-y-3">
                                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                                          <p className="text-xs font-medium text-muted-foreground mb-2">
                                            Preview (first {Math.max(previewRows.length - 1, 0)} rows)
                                          </p>
                                          <div className="overflow-x-auto">
                                            <table className="min-w-full text-xs">
                                              <thead className="bg-muted/50">
                                                <tr>
                                                  {previewRows[0]?.map((cell, index) => (
                                                    <th
                                                      key={index}
                                                      className="px-2 py-1 text-left font-medium text-muted-foreground"
                                                    >
                                                      {cell}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {previewRows.slice(1).map((row, rowIndex) => (
                                                  <tr key={rowIndex} className="border-t">
                                                    {row.map((cell, cellIndex) => (
                                                      <td key={cellIndex} className="px-2 py-1 text-muted-foreground">
                                                        {cell || "-"}
                                                      </td>
                                                    ))}
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                        <MiniSheetPreview
                                          rangeA1={rangeA1}
                                          previewRows={previewRows}
                                          columns={columnOptions}
                                        />
                                      </div>
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Spreadsheet</p>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Input
                                    value={sheetInput}
                                    onChange={(event) => {
                                      setSheetInput(event.target.value);
                                      setSheetMetadata(null);
                                    }}
                                    placeholder="Paste a Google Sheets URL or ID"
                                  />
                                  <Button
                                    variant="outline"
                                    onClick={() => handleLoadSheetMetadata()}
                                    disabled={!sheetInput.trim() || Boolean(setupBlockedReason)}
                                  >
                                    Load
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={handleOpenPicker}
                                    disabled={pickerLoading || Boolean(setupBlockedReason)}
                                  >
                                    {pickerLoading ? "Opening..." : "Pick from Drive"}
                                  </Button>
                                </div>
                                {!pickerReady && (
                                  <p className="text-[11px] text-muted-foreground">
                                    Google Picker will open in a new window. Allow pop-ups if blocked.
                                  </p>
                                )}
                              </div>

                              {sheetMetadata && (
                                <div className="rounded-md border p-3 text-xs">
                                  <p className="font-medium">Selected sheet</p>
                                  <p className="text-muted-foreground mt-1">{sheetMetadata.sheetTitle}</p>
                                  <a
                                    href={sheetMetadata.sheetUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline text-[11px]"
                                  >
                                    Open in Google Sheets
                                  </a>
                                  {sheetMetadata.tabs.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {sheetMetadata.tabs.map((tab) => (
                                        <Button
                                          key={tab}
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setSheetTabName(tab)}
                                        >
                                          {tab}
                                        </Button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="space-y-2">
                                <p className="text-sm font-medium">Report Type</p>
                                <Select
                                  value={sheetReportType}
                                  onValueChange={(value) => setSheetReportType(value as ReportType)}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select report">
                                      {reportTypeLabels[sheetReportType]}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="member-hours">Member Hours Summary</SelectItem>
                                      <SelectItem value="project-summary">Project Summary</SelectItem>
                                      <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
                                    </SelectGroup>
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
                                <p className="text-[11px] text-muted-foreground">Use an existing tab name or type a new one.</p>
                              </div>

                              <div className="space-y-2">
                                <p className="text-sm font-medium">Range</p>
                                <RangeBuilder
                                  columns={columnOptions}
                                  mode={rangeMode}
                                  onModeChange={setRangeMode}
                                  startColumn={rangeStartColumn}
                                  startRow={rangeStartRow}
                                  endColumn={rangeEndColumn}
                                  endRow={rangeEndRow}
                                  onStartColumnChange={setRangeStartColumn}
                                  onStartRowChange={setRangeStartRow}
                                  onEndColumnChange={setRangeEndColumn}
                                  onEndRowChange={setRangeEndRow}
                                  helperText="Pick the top-left anchor. The report will expand to fit the data."
                                />
                              </div>

                              <Accordion>
                                <AccordionItem value="layout">
                                  <AccordionTrigger className="text-sm font-semibold">
                                    Layout & preview
                                  </AccordionTrigger>
                                  <AccordionContent className="space-y-3">
                                    <ReportLayoutCustomizer
                                      reportType={sheetReportType}
                                      currentLayout={layoutConfig}
                                      onLayoutChange={(config) => setLayoutConfig(config)}
                                      isLoading={previewLoading}
                                      onReset={() => setPreviewRows(null)}
                                    />

                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handlePreviewReport}
                                        disabled={previewLoading || Boolean(setupBlockedReason)}
                                      >
                                        {previewLoading ? "Loading preview..." : "Preview data"}
                                      </Button>
                                      <Button
                                        onClick={handleConnectExistingSheet}
                                        disabled={connectingSheet || !sheetMetadata || Boolean(setupBlockedReason)}
                                      >
                                        {connectingSheet ? "Connecting..." : "Connect Sheet"}
                                      </Button>
                                    </div>

                                    {previewRows && (
                                      <div className="space-y-3">
                                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                                          <p className="text-xs font-medium text-muted-foreground mb-2">
                                            Preview (first {Math.max(previewRows.length - 1, 0)} rows)
                                          </p>
                                          <div className="overflow-x-auto">
                                            <table className="min-w-full text-xs">
                                              <thead className="bg-muted/50">
                                                <tr>
                                                  {previewRows[0]?.map((cell, index) => (
                                                    <th
                                                      key={index}
                                                      className="px-2 py-1 text-left font-medium text-muted-foreground"
                                                    >
                                                      {cell}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {previewRows.slice(1).map((row, rowIndex) => (
                                                  <tr key={rowIndex} className="border-t">
                                                    {row.map((cell, cellIndex) => (
                                                      <td key={cellIndex} className="px-2 py-1 text-muted-foreground">
                                                        {cell || "-"}
                                                      </td>
                                                    ))}
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                        <MiniSheetPreview
                                          rangeA1={rangeA1}
                                          previewRows={previewRows}
                                          columns={columnOptions}
                                        />
                                      </div>
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            </div>
                          )}

                          {setupError && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                              {setupError}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {unlinkIntent === "switch" ? "Switch spreadsheet destination?" : "Disconnect spreadsheet sync?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {unlinkIntent === "switch"
                  ? "This will unlink the current sheet destination while keeping your Google account connected. You can choose a new destination right after."
                  : "This will unlink the current sheet destination and stop all automatic sheet sync jobs for this organization."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={unlinkingSheet}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmUnlinkSheet();
                }}
                disabled={unlinkingSheet}
              >
                {unlinkingSheet
                  ? "Processing..."
                  : unlinkIntent === "switch"
                    ? "Unlink & switch"
                    : "Disconnect"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart className="h-4 w-4 text-muted-foreground" />
            Projects with Most Hours
          </CardTitle>
          <CardDescription>Top 3 projects by total hours logged</CardDescription>
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
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium truncate">{project.title}</p>
                    <Badge variant={getProjectStatusBadgeVariant(project.status)}>
                      {formatProjectStatusLabel(project.status)}
                    </Badge>
                  </div>
                  <Badge variant="secondary">{(project.totalHours ?? 0).toFixed(1)}h</Badge>
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

function formatProjectStatusLabel(status: string | null | undefined) {
  if (!status) return "Unknown";

  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getProjectStatusBadgeVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "secondary";
    case "cancelled":
      return "destructive";
    case "upcoming":
    case "draft":
      return "outline";
    default:
      return "outline";
  }
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

function RangeBuilder({
  columns,
  mode,
  onModeChange,
  startColumn,
  startRow,
  endColumn,
  endRow,
  onStartColumnChange,
  onStartRowChange,
  onEndColumnChange,
  onEndRowChange,
  disabled,
  helperText,
}: {
  columns: string[];
  mode: "full" | "custom";
  onModeChange: (value: "full" | "custom") => void;
  startColumn: string;
  startRow: string;
  endColumn: string;
  endRow: string;
  onStartColumnChange: (value: string) => void;
  onStartRowChange: (value: string) => void;
  onEndColumnChange: (value: string) => void;
  onEndRowChange: (value: string) => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const sanitizeRow = (value: string) => value.replace(/\D/g, "");
  const columnToIndex = (column: string) =>
    column
      .toUpperCase()
      .split("")
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  const indexToColumn = (index: number) => {
    let value = index;
    let column = "";
    while (value > 0) {
      const modulo = (value - 1) % 26;
      column = String.fromCharCode(65 + modulo) + column;
      value = Math.floor((value - 1) / 26);
    }
    return column || "A";
  };

  const startColumnIndex = columnToIndex(startColumn || "A");
  const endColumnIndex = columnToIndex(endColumn || startColumn || "A");
  const columnSpan = Math.max(endColumnIndex - startColumnIndex + 1, 1);
  const startRowNumber = Math.max(Number.parseInt(startRow || "1", 10) || 1, 1);
  const endRowNumber = Math.max(Number.parseInt(endRow || startRow || "1", 10) || 1, 1);
  const rowSpan = Math.max(endRowNumber - startRowNumber + 1, 1);

  useEffect(() => {
    if (startColumnIndex > endColumnIndex) {
      onEndColumnChange(startColumn);
    }
    if (startRowNumber > endRowNumber) {
      onEndRowChange(String(startRowNumber));
    }
  }, [
    startColumnIndex,
    endColumnIndex,
    startRowNumber,
    endRowNumber,
    onEndColumnChange,
    onEndRowChange,
    startColumn,
  ]);

  const handleColumnSpanChange = (value: string) => {
    const span = Math.max(Number.parseInt(value, 10) || 1, 1);
    const newEndIndex = startColumnIndex + span - 1;
    onEndColumnChange(indexToColumn(newEndIndex));
  };

  const handleRowSpanChange = (value: string) => {
    const span = Math.max(Number.parseInt(value, 10) || 1, 1);
    const newEndRow = startRowNumber + span - 1;
    onEndRowChange(String(newEndRow));
  };

  const rangeLabel =
    mode === "full"
      ? "A1"
      : `${startColumn}${startRowNumber}:${indexToColumn(
        startColumnIndex + columnSpan - 1
      )}${startRowNumber + rowSpan - 1}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as "full" | "custom")}
          disabled={disabled}
        >
          <SelectTrigger className="w-fit">
            <SelectValue placeholder="Range mode">
              {rangeModeLabels[mode]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="full">Full tab (A1)</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant="secondary">Range: {rangeLabel}</Badge>
      </div>

      {mode === "custom" && (
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-background p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Anchor (top-left)
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Select value={startColumn} onValueChange={(val) => val && onStartColumnChange(val)} disabled={disabled}>
                <SelectTrigger className="w-22.5">
                  <SelectValue placeholder="Col" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {columns.map((column) => (
                      <SelectItem key={column} value={column}>
                        {column}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                value={startRow}
                onChange={(event) => onStartRowChange(sanitizeRow(event.target.value))}
                className="h-9"
                disabled={disabled}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Data starts here and expands to fit the report.
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Span (preview only)
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground">Columns</label>
                <Input
                  type="number"
                  min={1}
                  max={26}
                  value={columnSpan}
                  onChange={(event) => handleColumnSpanChange(event.target.value)}
                  className="h-9"
                  disabled={disabled}
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Rows</label>
                <Input
                  type="number"
                  min={1}
                  value={rowSpan}
                  onChange={(event) => handleRowSpanChange(event.target.value)}
                  className="h-9"
                  disabled={disabled}
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              This doesn’t limit data; it just helps visualize placement.
            </p>
          </div>
        </div>
      )}

      {helperText && <p className="text-[11px] text-muted-foreground">{helperText}</p>}
    </div>
  );
}

function MiniSheetPreview({
  rangeA1,
  previewRows,
  columns,
}: {
  rangeA1: string;
  previewRows: string[][] | null;
  columns: string[];
}) {
  const visibleColumns = columns.slice(0, 8);
  const visibleRows = 10;
  const dataRows = previewRows?.length || 4;
  const dataColumns = Math.max(
    previewRows?.reduce((max, row) => Math.max(max, row.length), 0) || 4,
    1
  );

  const parseCell = (cell: string) => {
    const match = cell.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) return null;
    return {
      column: match[1].toUpperCase(),
      row: Number.parseInt(match[2], 10),
    };
  };

  const columnToIndex = (column: string) =>
    column
      .toUpperCase()
      .split("")
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);

  const range = rangeA1.includes("!") ? rangeA1.split("!")[1] : rangeA1;
  const startCell = parseCell(range.split(":")[0] || "A1") || {
    column: "A",
    row: 1,
  };
  const startColumnIndex = columnToIndex(startCell.column);
  const overlayEndColumn = startColumnIndex + dataColumns - 1;
  const overlayEndRow = startCell.row + dataRows - 1;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-[11px] font-medium text-muted-foreground mb-2">
        Overlay preview (top-left at {startCell.column}{startCell.row})
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[10px]">
          <thead>
            <tr>
              <th className="w-8 text-muted-foreground"></th>
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  className="px-2 py-1 text-center font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: visibleRows }, (_, rowIndex) => {
              const rowNumber = rowIndex + 1;
              return (
                <tr key={rowNumber} className="border-t">
                  <td className="px-1 py-1 text-center text-muted-foreground">
                    {rowNumber}
                  </td>
                  {visibleColumns.map((col) => {
                    const colIndex = columnToIndex(col);
                    const isOverlay =
                      colIndex >= startColumnIndex &&
                      colIndex <= overlayEndColumn &&
                      rowNumber >= startCell.row &&
                      rowNumber <= overlayEndRow;

                    return (
                      <td
                        key={`${col}-${rowNumber}`}
                        className={`h-5 w-10 border-l text-center ${isOverlay ? "bg-primary/15" : "bg-transparent"
                          }`}
                      ></td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}