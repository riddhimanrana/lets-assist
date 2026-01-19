"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

type GooglePickerBuilder = {
  setTitle: (title: string) => GooglePickerBuilder;
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
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
  const isAdmin = userRole === "admin";
  const canSyncSheets = userRole === "admin" || userRole === "staff";
  const needsSheetScopes = sheetStatus?.connected && sheetStatus?.scopesOk === false;
  const connectedByLabel =
    sheetStatus?.connectedBy?.name || sheetStatus?.connectedBy?.email || null;
  const hasSheetOwner = Boolean(sheetStatus?.connectedBy);
  const hasSyncConfig = Boolean(sheetStatus?.syncConfig);
  const canReconnect = isAdmin && (!hasSheetOwner || (sheetStatus?.viewerIsOwner ?? false));
  const connectUrl = `/api/calendar/google/connect?scopes=sheets&sheets_sync=1&force=1&return_to=${encodeURIComponent(
    `/organization/${organizationId}`
  )}`;
  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

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

  const applyRangeFromConfig = useCallback((rangeInput?: string | null) => {
    if (!rangeInput || rangeInput.trim().length === 0) {
      setRangeMode("full");
      setRangeStartColumn("A");
      setRangeStartRow("1");
      setRangeEndColumn("H");
      setRangeEndRow("20");
      return;
    }

    const raw = rangeInput.includes("!") ? rangeInput.split("!")[1] : rangeInput;
    const normalized = raw?.trim() || "";

    if (!normalized || normalized.toUpperCase() === "A1") {
      setRangeMode("full");
      setRangeStartColumn("A");
      setRangeStartRow("1");
      setRangeEndColumn("H");
      setRangeEndRow("20");
      return;
    }

    const [start, end] = normalized.split(":");
    const startMatch = start?.match(/^([A-Za-z]+)(\d+)$/);
    const endMatch = end?.match(/^([A-Za-z]+)(\d+)$/);

    if (startMatch && endMatch) {
      setRangeMode("custom");
      setRangeStartColumn(startMatch[1].toUpperCase());
      setRangeStartRow(startMatch[2]);
      setRangeEndColumn(endMatch[1].toUpperCase());
      setRangeEndRow(endMatch[2]);
      return;
    }

    if (startMatch && !endMatch) {
      setRangeMode("custom");
      setRangeStartColumn(startMatch[1].toUpperCase());
      setRangeStartRow(startMatch[2]);
      setRangeEndColumn(startMatch[1].toUpperCase());
      setRangeEndRow(startMatch[2]);
      return;
    }

    setRangeMode("custom");
  }, []);

  const loadAvailableOwners = useCallback(async () => {
    if (!isAdmin) return;
    setOwnersLoading(true);
    const result = await getAvailableSheetOwners(organizationId);
    if (result.success) {
      setAvailableOwners(result.owners);
    }
    setOwnersLoading(false);
  }, [organizationId, isAdmin]);

  const resetSetupWizard = useCallback(() => {
    setSetupMode("create");
    setSheetInput("");
    setSheetMetadata(null);
    setPreviewRows(null);
    setPreviewRequested(false);
    setSetupError(null);
  }, []);

  const loadGoogleApi = useCallback(() => {
    if (typeof window === "undefined") {
      return Promise.resolve(false);
    }

    const windowRef = window as unknown as GoogleApiWindow;

    if (windowRef.gapi?.load) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-google-picker="true"]'
      );
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(true));
        existingScript.addEventListener("error", () => reject(new Error("Failed to load Google API")));
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

  const ensurePickerLoaded = useCallback(async () => {
    if (typeof window === "undefined") return false;

    const windowRef = window as unknown as GoogleApiWindow;

    if (windowRef.google?.picker) {
      setPickerReady(true);
      return true;
    }

    try {
      await loadGoogleApi();
    } catch {
      return false;
    }

    await new Promise<void>((resolve) => {
      windowRef.gapi?.load("picker", { callback: () => resolve() });
    });

    setPickerReady(true);
    return true;
  }, [loadGoogleApi]);

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
      applyRangeFromConfig(sheetStatus.syncConfig.rangeA1 || "A1");
      const reportType = sheetStatus.syncConfig.reportType || "member-hours";
      const defaultLayout = getDefaultLayout(reportType);
      setLayoutConfig(sheetStatus.syncConfig.layoutConfig ?? defaultLayout);
    }
  }, [sheetStatus, applyRangeFromConfig]);

  useEffect(() => {
    if (!layoutConfig || layoutConfig.reportType !== sheetReportType) {
      setLayoutConfig(getDefaultLayout(sheetReportType));
    }
  }, [layoutConfig, sheetReportType]);

  useEffect(() => {
    if (!sheetStatus?.syncConfig) {
      setSelectedOwnerId(null);
      return;
    }
    setSelectedOwnerId(sheetStatus.connectedBy?.id || null);
  }, [sheetStatus?.syncConfig, sheetStatus?.connectedBy?.id]);

  useEffect(() => {
    if (sheetStatus?.connected && isAdmin) {
      loadAvailableOwners();
    }
  }, [sheetStatus?.connected, isAdmin, loadAvailableOwners]);

  useEffect(() => {
    if (!previewRequested) {
      setPreviewRows(null);
    }
  }, [sheetReportType, layoutConfig, previewRequested]);

  useEffect(() => {
    if (!isAdmin || !sheetStatus?.connected || sheetStatus?.syncConfig || setupMode !== "existing") {
      return;
    }

    ensurePickerLoaded().catch(() => {
      setPickerReady(false);
    });
  }, [ensurePickerLoaded, isAdmin, sheetStatus?.connected, sheetStatus?.syncConfig, setupMode]);

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
    const result = await createSheetSync(
      organizationId,
      sheetReportType,
      sheetTabName.trim() || "Member Hours",
      rangeA1,
      layoutConfig
    );
    if (!result.success) {
      toast.error(result.error || "Failed to create sheet");
    } else {
      toast.success("Google Sheet created");
      await loadSheetStatus();
      resetSetupWizard();
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
      rangeA1,
      layoutConfig,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update sheet config");
      return;
    }

    toast.success("Sheet config updated");
    await loadSheetStatus();
  };

  const handleSetupModeChange = (mode: "create" | "existing") => {
    setSetupMode(mode);
    setSetupError(null);
    setSheetMetadata(null);
    setSheetInput("");
    setPreviewRows(null);
    setPreviewRequested(false);
  };

  const handleLoadSheetMetadata = async (inputOverride?: string) => {
    const target = (inputOverride ?? sheetInput).trim();
    if (!target) {
      setSetupError("Enter a spreadsheet URL or ID.");
      setSheetMetadata(null);
      return;
    }

    setSetupError(null);
    const result = await getSpreadsheetSetupMetadata(organizationId, target);
    if (!result.success || !result.metadata) {
      setSetupError(result.error || "Unable to access that spreadsheet.");
      setSheetMetadata(null);
      return;
    }

    setSheetMetadata({
      sheetId: result.metadata.sheetId,
      sheetTitle: result.metadata.sheetTitle,
      sheetUrl: result.metadata.sheetUrl,
      tabs: result.metadata.tabs,
    });
    setSheetInput(result.metadata.sheetUrl);
  };

  const handlePreviewReport = useCallback(async () => {
    setPreviewRequested(true);
    setPreviewLoading(true);
    setSetupError(null);
    const result = await getSheetReportPreview(organizationId, sheetReportType, 12, layoutConfig);
    if (!result.success || !result.rows) {
      setSetupError(result.error || "Unable to load preview data.");
      setPreviewRows(null);
    } else {
      setPreviewRows(result.rows);
    }
    setPreviewLoading(false);
  }, [organizationId, sheetReportType, layoutConfig]);

  useEffect(() => {
    if (!previewRequested) return;
    void handlePreviewReport();
  }, [handlePreviewReport, previewRequested]);

  const handleOpenPicker = async () => {
    setPickerLoading(true);
    setSetupError(null);

    if (!pickerApiKey) {
      setSetupError("Google Picker API key is missing.");
      setPickerLoading(false);
      return;
    }

    const tokenResult = await getSheetsAccessTokenForPicker(organizationId);
    if (!tokenResult.success || !tokenResult.accessToken) {
      setSetupError(tokenResult.error || "Unable to open Google Picker.");
      setPickerLoading(false);
      return;
    }

    const ready = await ensurePickerLoaded();
    if (!ready) {
      setSetupError("Unable to load Google Picker.");
      setPickerLoading(false);
      return;
    }

    const windowRef = window as unknown as GoogleApiWindow;
    const google = windowRef.google;
    if (!google?.picker) {
      setSetupError("Google Picker is not available.");
      setPickerLoading(false);
      return;
    }
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
    view.setMimeTypes("application/vnd.google-apps.spreadsheet");
    view.setOwnedByMe?.(true);

    const picker = new google.picker.PickerBuilder()
      .setTitle("Select a Google Sheet")
      .addView(view)
      .setOAuthToken(tokenResult.accessToken)
      .setDeveloperKey(pickerApiKey)
      .setCallback((data: PickerCallbackData) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          if (doc?.id) {
            setSheetInput(doc.id);
            void handleLoadSheetMetadata(doc.id);
          }
        }
      })
      .build();

    picker.setVisible(true);
    setPickerLoading(false);
  };

  const handleConnectExistingSheet = async () => {
    if (!sheetMetadata?.sheetId) {
      setSetupError("Select a spreadsheet first.");
      return;
    }

    setConnectingSheet(true);
    setSetupError(null);

    const result = await connectExistingSheet(organizationId, {
      sheetId: sheetMetadata.sheetId,
      reportType: sheetReportType,
      tabName: sheetTabName.trim() || "Member Hours",
      rangeA1,
      layoutConfig,
    });

    if (!result.success) {
      toast.error(result.error || "Failed to connect Google Sheet");
      setSetupError(result.error || "Failed to connect Google Sheet");
    } else {
      toast.success("Google Sheet connected");
      await loadSheetStatus();
      resetSetupWizard();
    }

    setConnectingSheet(false);
  };

  const handleUnlinkSheet = async () => {
    setUnlinkingSheet(true);
    const result = await unlinkSheetSync(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to unlink sheet");
    } else {
      toast.success("Sheet unlinked");
      await loadSheetStatus();
      if (unlinkIntent === "switch") {
        setSetupMode("existing");
      }
    }
    setUnlinkingSheet(false);
    setShowUnlinkDialog(false);
  };

  const handleUpdateOwner = async () => {
    if (!selectedOwnerId) {
      toast.error("Select a sheet owner first");
      return;
    }

    setUpdatingOwner(true);
    const result = await updateSheetOwner(organizationId, selectedOwnerId);
    if (!result.success) {
      toast.error(result.error || "Failed to update sheet owner");
    } else {
      toast.success("Sheet owner updated");
      await loadSheetStatus();
    }
    setUpdatingOwner(false);
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
            className="w-full sm:w-auto gap-2"
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <SummaryCard
          title="Total Hours"
          icon={Clock}
          value={metrics?.totalHours.toFixed(1) || "0.0"}
          description="Verified + pending + unpublished"
          loading={loading}
        />
        <SummaryCard
          title="Verified"
          icon={BarChart}
          value={metrics?.verifiedHours.toFixed(1) || "0.0"}
          description="Approved hours"
          loading={loading}
        />
        <SummaryCard
          title="Pending"
          icon={Clock}
          value={metrics?.pendingHours.toFixed(1) || "0.0"}
          description="Awaiting check"
          loading={loading}
        />
        <SummaryCard
          title="Volunteers"
          icon={Users}
          value={metrics?.totalVolunteers || 0}
          description="Unique users"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="p-4 sm:pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart className="h-4 w-4 text-muted-foreground" />
              Monthly Hours Trend
            </CardTitle>
            <CardDescription className="text-xs">Verified, pending, and unpublished hours</CardDescription>
          </CardHeader>
          <CardContent className="p-2 sm:p-6">
            {loading ? (
              <Skeleton className="h-[200px] w-full sm:h-[220px]" />
            ) : monthlyData.length === 0 ? (
              <div className="h-[200px] sm:h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                No hours recorded for this period.
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[220px] w-full min-h-[200px]">
                <RechartsBarChart data={monthlyData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tick={{ fontSize: 10 }}
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
          <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {unlinkIntent === "switch" ? "Switch Google Sheet?" : "Unlink Google Sheet?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {unlinkIntent === "switch"
                    ? "This will disconnect the current sheet and let you pick a new one."
                    : "This will remove the current sheet sync configuration for this organization."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={unlinkingSheet}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleUnlinkSheet} disabled={unlinkingSheet}>
                  {unlinkingSheet ? "Unlinking..." : "Confirm"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>

        <Card className="relative overflow-hidden">
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
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Connect to start syncing
                    </p>
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
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {sheetStatus.syncConfig?.sheetUrl && (
                      <Button asChild variant="outline" size="sm">
                        <a href={sheetStatus.syncConfig.sheetUrl} target="_blank" rel="noreferrer">
                          Open sheet
                        </a>
                      </Button>
                    )}
                    {sheetStatus.syncConfig && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSyncSheetNow}
                        disabled={!canSyncSheets || syncingSheet || needsSheetScopes}
                      >
                        {syncingSheet ? "Syncing..." : "Sync now"}
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
                  </div>
                </div>
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
                    {isAdmin ? (
                      <Accordion
                        type="multiple"
                        value={sheetConfigSections}
                        onValueChange={setSheetConfigSections}
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
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select owner" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ownersLoading && (
                                      <SelectItem value="loading" disabled>
                                        Loading connected members...
                                      </SelectItem>
                                    )}
                                    {!ownersLoading && availableOwners.length === 0 && (
                                      <SelectItem value="none" disabled>
                                        No connected members found
                                      </SelectItem>
                                    )}
                                    {availableOwners.map((owner) => (
                                      <SelectItem key={owner.id} value={owner.id}>
                                        {owner.name || owner.email || "Member"}
                                        {owner.connectedEmail ? ` • ${owner.connectedEmail}` : ""}
                                        {owner.hasSheetsAccess ? "" : " (needs Sheets access)"}
                                      </SelectItem>
                                    ))}
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
                                  This member must reconnect Google with Sheets access before becoming the owner.
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

                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                variant="outline"
                                size="sm"
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
                                onClick={() => {
                                  setUnlinkIntent("unlink");
                                  setShowUnlinkDialog(true);
                                }}
                              >
                                Unlink sheet
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ) : (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Report type: {sheetStatus.syncConfig.reportType}</p>
                        <p>Sheet tab: {sheetStatus.syncConfig.tabName || "Member Hours"}</p>
                        <p>Range: {sheetStatus.syncConfig.rangeA1 || "A1"}</p>
                        <p>Auto sync: {sheetStatus.syncConfig.autoSync ? "On" : "Off"}</p>
                        <p>Interval: {sheetStatus.syncConfig.syncIntervalMinutes} minutes</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="text-sm text-muted-foreground">
                      Set up a Google Sheet to sync organization reports.
                    </p>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
                      <span className="font-medium text-primary">Admins own the Sheets connection.</span>
                      <span className="text-muted-foreground"> Staff can view and sync data once the sheet is linked.</span>
                    </div>
                    {isAdmin ? (
                      <div className="space-y-4">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            variant={setupMode === "create" ? "default" : "outline"}
                            onClick={() => handleSetupModeChange("create")}
                            disabled={needsSheetScopes}
                          >
                            Create new sheet
                          </Button>
                          <Button
                            variant={setupMode === "existing" ? "default" : "outline"}
                            onClick={() => handleSetupModeChange("existing")}
                            disabled={needsSheetScopes}
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

                            <Accordion type="single" collapsible>
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
                                    <Button onClick={handleCreateSheet} disabled={creatingSheet || needsSheetScopes}>
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
                                  disabled={!sheetInput.trim()}
                                >
                                  Load
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={handleOpenPicker}
                                  disabled={pickerLoading || needsSheetScopes}
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

                            <Accordion type="single" collapsible>
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
                                    <Button
                                      onClick={handleConnectExistingSheet}
                                      disabled={connectingSheet || !sheetMetadata || needsSheetScopes}
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
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        An admin needs to finish the Google Sheets setup before syncs can run.
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
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Range mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full tab (A1)</SelectItem>
            <SelectItem value="custom">Custom range</SelectItem>
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
              <Select value={startColumn} onValueChange={onStartColumnChange} disabled={disabled}>
                <SelectTrigger className="h-9 w-[90px]">
                  <SelectValue placeholder="Col" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
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
                        className={`h-5 w-10 border-l text-center ${
                          isOverlay ? "bg-primary/15" : "bg-transparent"
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