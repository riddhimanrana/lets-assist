"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ReportType } from "../actions";
import {
  buildReportsGoogleSheetPicker,
  type GoogleApiWindow,
  type PickerCallbackData,
} from "../google-picker";
import { type ReportLayoutConfig } from "../report-layouts";
import {
  connectExistingSheet,
  createSheetSync,
  getSheetReportPreview,
  getSheetsAccessTokenForPicker,
  getSpreadsheetSetupMetadata,
  updateSheetSyncConfig,
  type SheetSyncStatus,
} from "../sheets-actions";
import { parseSavedRange, type SheetSetupMetadata } from "./sheet-sync-options";

/**
 * Destination, layout and setup state for the organization Sheets sync, with
 * the handlers that create, connect and reconfigure the destination.
 */
export function useSheetSyncSetup({
  organizationId,
  sheetStatus,
  handleLoadSheetStatus,
}: {
  organizationId: string;
  sheetStatus: SheetSyncStatus | null;
  handleLoadSheetStatus: () => Promise<void> | void;
}) {
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [sheetTabName, setSheetTabName] = useState("Member Hours");
  const [sheetReportType, setSheetReportType] =
    useState<ReportType>("member-hours");
  const [rangeMode, setRangeMode] = useState<"full" | "custom">("full");
  const [rangeStartColumn, setRangeStartColumn] = useState("A");
  const [rangeStartRow, setRangeStartRow] = useState("1");
  const [rangeEndColumn, setRangeEndColumn] = useState("H");
  const [rangeEndRow, setRangeEndRow] = useState("20");
  const [layoutConfig, setLayoutConfig] = useState<ReportLayoutConfig | null>(
    null,
  );
  const [setupMode, setSetupMode] = useState<"create" | "existing">("create");
  const [sheetInput, setSheetInput] = useState("");
  const [sheetMetadata, setSheetMetadata] = useState<SheetSetupMetadata | null>(
    null,
  );
  const [previewRows, setPreviewRows] = useState<string[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [connectingSheet, setConnectingSheet] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

  // Show the saved destination, not the defaults, when a sync already exists.
  const savedConfig = sheetStatus?.syncConfig ?? null;
  const savedConfigKey = savedConfig
    ? JSON.stringify([
        savedConfig.sheetId,
        savedConfig.tabName,
        savedConfig.reportType,
        savedConfig.rangeA1 ?? null,
        savedConfig.layoutConfig ?? null,
      ])
    : null;
  useEffect(() => {
    if (!savedConfig) return;
    setSheetTabName(savedConfig.tabName);
    setSheetReportType(savedConfig.reportType);
    setLayoutConfig(savedConfig.layoutConfig ?? null);
    const savedRange = parseSavedRange(savedConfig.rangeA1);
    if (savedRange) {
      setRangeMode(savedRange.mode);
      setRangeStartColumn(savedRange.startColumn);
      setRangeStartRow(savedRange.startRow);
      setRangeEndColumn(savedRange.endColumn);
      setRangeEndRow(savedRange.endRow);
    } else {
      setRangeMode("full");
    }
    // savedConfigKey stands in for the saved destination's identity.
  }, [savedConfigKey]);

  const columnOptions = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
    [],
  );

  const rangeA1 = useMemo(() => {
    if (rangeMode === "full") {
      return "A1";
    }
    const startRow = rangeStartRow || "1";
    const endRow = rangeEndRow || startRow;
    return `${rangeStartColumn}${startRow}:${rangeEndColumn}${endRow}`;
  }, [rangeMode, rangeStartColumn, rangeStartRow, rangeEndColumn, rangeEndRow]);

  const handleUpdateSheetConfig = useCallback(async () => {
    if (!sheetStatus?.syncConfig) return;
    setSavingConfig(true);
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
    setSavingConfig(false);
  }, [
    organizationId,
    sheetTabName,
    sheetReportType,
    rangeA1,
    layoutConfig,
    sheetStatus?.syncConfig,
    handleLoadSheetStatus,
  ]);

  const handlePreviewReport = useCallback(async () => {
    setPreviewLoading(true);
    const result = await getSheetReportPreview(
      organizationId,
      sheetReportType,
      12,
      layoutConfig,
    );
    if (result.error || !result.rows) {
      toast.error(result.error || "Failed to generate preview");
    } else {
      setPreviewRows(result.rows);
    }
    setPreviewLoading(false);
  }, [organizationId, sheetReportType, layoutConfig]);

  const handleCreateSheet = useCallback(async () => {
    setCreatingSheet(true);
    const result = await createSheetSync(
      organizationId,
      sheetReportType,
      sheetTabName,
      rangeA1,
      layoutConfig,
    );
    if (result.success) {
      toast.success("Sheet created successfully");
      handleLoadSheetStatus();
    } else {
      setSetupError(result.error || "Failed to create sheet");
    }
    setCreatingSheet(false);
  }, [
    organizationId,
    sheetReportType,
    sheetTabName,
    rangeA1,
    layoutConfig,
    handleLoadSheetStatus,
  ]);

  const handleLoadSheetMetadata = useCallback(async () => {
    if (!sheetInput.trim()) return;
    setPickerLoading(true);
    const result = await getSpreadsheetSetupMetadata(
      organizationId,
      sheetInput.trim(),
    );
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

  const handleSheetInputChange = (value: string) => {
    setSheetInput(value);
    setSheetMetadata(null);
  };

  const resetSetup = useCallback(() => {
    setSetupError(null);
    setSheetMetadata(null);
  }, []);

  const handleConnectExistingSheet = useCallback(async () => {
    if (!sheetMetadata) return;
    setConnectingSheet(true);
    const result = await connectExistingSheet(organizationId, {
      sheetId: sheetMetadata.sheetId,
      reportType: sheetReportType,
      tabName: sheetTabName,
      rangeA1,
      layoutConfig,
    });
    if (result.success) {
      toast.success("Sheet connected successfully");
      handleLoadSheetStatus();
    } else {
      setSetupError(result.error || "Failed to connect sheet");
    }
    setConnectingSheet(false);
  }, [
    organizationId,
    sheetMetadata,
    sheetReportType,
    sheetTabName,
    rangeA1,
    layoutConfig,
    handleLoadSheetStatus,
  ]);

  const loadGoogleApi = useCallback(() => {
    const win = window as unknown as GoogleApiWindow;
    if (win.gapi?.load) return Promise.resolve(true);

    return new Promise<boolean>((resolve, reject) => {
      const existing = document.querySelector(
        'script[data-google-picker="true"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(true));
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load Google API")),
        );
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
    const win = window as unknown as GoogleApiWindow;
    if (win.google?.picker) {
      setPickerReady(true);
      return true;
    }

    try {
      await loadGoogleApi();
    } catch {
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
      if (!tokenResult.success) {
        setSetupError(
          tokenResult.error || "Unable to open Google Picker. Try again.",
        );
        return;
      }

      if (!pickerApiKey) {
        setSetupError(
          "Google Picker is not configured. Missing NEXT_PUBLIC_GOOGLE_PICKER_API_KEY.",
        );
        return;
      }

      if (!(await initPicker())) {
        setSetupError("Unable to load Google Picker library.");
        return;
      }

      const win = window as unknown as GoogleApiWindow;
      const google = win.google;
      if (!google?.picker) {
        setSetupError("Google Picker is not available.");
        return;
      }

      const view = new google.picker.DocsView(
        google.picker.ViewId.SPREADSHEETS,
      );
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");

      const picker = buildReportsGoogleSheetPicker({
        builder: new google.picker.PickerBuilder(),
        title: "Select a Google Sheet",
        view,
        accessToken: tokenResult.accessToken,
        developerKey: pickerApiKey,
        pickerAppId: tokenResult.pickerAppId,
        callback: async (data: PickerCallbackData) => {
          if (data.action !== google.picker.Action.PICKED) {
            return;
          }

          const doc = data.docs?.[0];
          if (!doc?.id) {
            return;
          }

          setSheetInput(doc.id);

          try {
            const metadataResult = await getSpreadsheetSetupMetadata(
              organizationId,
              doc.id,
            );
            if (
              !metadataResult.success ||
              metadataResult.error ||
              !metadataResult.metadata
            ) {
              setSheetMetadata(null);
              setSetupError(
                metadataResult.error ||
                  "Unable to load selected spreadsheet metadata.",
              );
              return;
            }

            setSetupError(null);
            setSheetMetadata(metadataResult.metadata);
          } catch {
            setSheetMetadata(null);
            setSetupError("Unable to load selected spreadsheet metadata.");
          }
        },
      });

      picker.setVisible(true);
    } finally {
      setPickerLoading(false);
    }
  }, [organizationId, initPicker, pickerApiKey]);

  return {
    columnOptions,
    rangeA1,
    destination: {
      sheetReportType,
      setSheetReportType,
      sheetTabName,
      setSheetTabName,
      range: {
        columns: columnOptions,
        mode: rangeMode,
        onModeChange: setRangeMode,
        startColumn: rangeStartColumn,
        startRow: rangeStartRow,
        endColumn: rangeEndColumn,
        endRow: rangeEndRow,
        onStartColumnChange: setRangeStartColumn,
        onStartRowChange: setRangeStartRow,
        onEndColumnChange: setRangeEndColumn,
        onEndRowChange: setRangeEndRow,
      },
    },
    layout: {
      reportType: sheetReportType,
      layoutConfig,
      setLayoutConfig,
      previewRows,
      setPreviewRows,
      previewLoading,
      handlePreviewReport,
      rangeA1,
      columns: columnOptions,
    },
    setupMode,
    handleSetupModeChange,
    sheetInput,
    handleSheetInputChange,
    sheetMetadata,
    setupError,
    resetSetup,
    pickerReady,
    pickerLoading,
    creatingSheet,
    connectingSheet,
    savingConfig,
    handleUpdateSheetConfig,
    handleCreateSheet,
    handleLoadSheetMetadata,
    handleConnectExistingSheet,
    handleOpenPicker,
  };
}

export type SheetSyncSetup = ReturnType<typeof useSheetSyncSetup>;
