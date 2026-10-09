"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ReportType } from "../actions";
import { type ReportLayoutConfig } from "../report-layouts";
import {
  connectExistingSheet,
  createSheetSync,
  getSheetReportPreview,
  getSpreadsheetSetupMetadata,
  updateSheetSyncConfig,
  type SheetSyncStatus,
} from "../sheets-actions";
import {
  buildRangeA1,
  parseSavedRange,
  type SheetSetupMetadata,
} from "./sheet-sync-options";
import { useSheetPicker } from "./useSheetPicker";

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
  // The end starts empty: a range is a fixed box only when an admin sets one.
  const [rangeEndColumn, setRangeEndColumn] = useState("");
  const [rangeEndRow, setRangeEndRow] = useState("");
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
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [connectingSheet, setConnectingSheet] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

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
      setRangeStartColumn("A");
      setRangeStartRow("1");
      setRangeEndColumn("");
      setRangeEndRow("");
    }
    // savedConfigKey stands in for the saved destination's identity.
  }, [savedConfigKey]);

  const columnOptions = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
    [],
  );

  const rangeA1 = useMemo(
    () =>
      buildRangeA1({
        mode: rangeMode,
        startColumn: rangeStartColumn,
        startRow: rangeStartRow,
        endColumn: rangeEndColumn,
        endRow: rangeEndRow,
      }),
    [rangeMode, rangeStartColumn, rangeStartRow, rangeEndColumn, rangeEndRow],
  );

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

  const loadSheetMetadata = useCallback(
    async (sheetReference: string) => {
      setLoadingMetadata(true);
      try {
        const result = await getSpreadsheetSetupMetadata(
          organizationId,
          sheetReference,
        );
        if (!result.success || result.error || !result.metadata) {
          setSheetMetadata(null);
          setSetupError(
            result.error || "Unable to load selected spreadsheet metadata.",
          );
        } else {
          setSheetMetadata(result.metadata);
          setSetupError(null);
        }
      } catch {
        setSheetMetadata(null);
        setSetupError("Unable to load selected spreadsheet metadata.");
      } finally {
        setLoadingMetadata(false);
      }
    },
    [organizationId],
  );

  const handleLoadSheetMetadata = useCallback(async () => {
    if (!sheetInput.trim()) return;
    await loadSheetMetadata(sheetInput.trim());
  }, [loadSheetMetadata, sheetInput]);

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

  const picker = useSheetPicker({
    organizationId,
    onPicked: async (sheetId) => {
      setSheetInput(sheetId);
      await loadSheetMetadata(sheetId);
    },
    onError: setSetupError,
  });

  const handleOpenPicker = async () => {
    setSetupError(null);
    await picker.openPicker();
  };

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
    pickerReady: picker.pickerReady,
    pickerLoading: picker.pickerLoading,
    loadingMetadata,
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
