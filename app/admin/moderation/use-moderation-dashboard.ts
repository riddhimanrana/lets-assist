"use client";
import { safeConsole } from "@/lib/safe-console";


import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";

import {
  getFlaggedContent,
  updateFlaggedContentStatus,
  getContentReports,
  updateContentReportStatus,
  runAiReviewForProject,
  takeModeratorAction,
} from "./actions";
import type {
  AiMetadata,
  ContentReport,
  FlaggedContent,
  FlaggedFilter,
  ReportsFilter,
  ScanEvent,
  ScanProgress,
  ScanResult,
} from "./dashboard-types";

/**
 * State and handlers for the moderation dashboard: the two queues, the detail
 * selections, the moderator actions, and the streamed AI scan.
 */
export function useModerationDashboard({
  initialFlagged,
  initialReports,
}: {
  initialFlagged: FlaggedContent[];
  initialReports: ContentReport[];
}) {
  const [flaggedContent, setFlaggedContent] = useState(initialFlagged);
  const [contentReports, setContentReports] = useState(initialReports);
  const [flaggedFilter, setFlaggedFilter] = useState<FlaggedFilter>("pending");
  const [reportFilter, setReportFilter] = useState<ReportsFilter>("pending");

  const [isFlaggedLoading, setIsFlaggedLoading] = useState(false);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [selectedFlag, setSelectedFlag] = useState<FlaggedContent | null>(null);
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(
    null,
  );

  // AI Scan streaming state
  const [isScanActive, setIsScanActive] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const loadFlaggedContent = async (status: FlaggedFilter) => {
    setIsFlaggedLoading(true);
    try {
      const result = await getFlaggedContent(status);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    } finally {
      setIsFlaggedLoading(false);
    }
  };

  const loadContentReports = async (status: ReportsFilter) => {
    setIsReportsLoading(true);
    try {
      const result = await getContentReports(status);
      if (result.data) {
        setContentReports(result.data);
      }
    } finally {
      setIsReportsLoading(false);
    }
  };

  const handleFlagStatusUpdate = async (
    id: string,
    status: FlaggedFilter,
    notes?: string,
  ) => {
    setIsActionLoading(true);
    try {
      const result = await updateFlaggedContentStatus(id, status, notes);
      if (result.error) {
        toast.error("Failed to update status");
        return;
      }
      toast.success("Status updated successfully");
      await loadFlaggedContent(flaggedFilter);
      setSelectedFlag(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReportStatusChange = async (
    id: string,
    status: ReportsFilter,
    notes?: string,
  ) => {
    setIsActionLoading(true);
    try {
      const result = await updateContentReportStatus(id, status, notes);
      if (result.error) {
        toast.error(`Failed to update report: ${result.error}`);
        return;
      }
      toast.success(result.message || "Report updated");
      await loadContentReports(reportFilter);
      setSelectedReport(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRunAiReviewForFlag = async (flag: FlaggedContent) => {
    if (!flag.content_id || flag.content_type !== "project") {
      toast.error("AI review is only available for projects");
      return;
    }

    setIsActionLoading(true);
    try {
      const result = await runAiReviewForProject(flag.content_id);
      if (result.error) {
        toast.error(`AI review failed: ${result.error}`);
        return;
      }
      if (result.data?.flagged) {
        toast.success("AI review flagged the project");
      } else {
        toast.info("AI review found no violations");
      }
      await loadFlaggedContent(flaggedFilter);
      setSelectedFlag(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleManualReportAction = async (
    reportId: string,
    action: "warn_user" | "remove_content" | "block_content",
    reason?: string,
  ) => {
    setIsActionLoading(true);
    try {
      const result = await takeModeratorAction(reportId, action, reason);
      if (result.error) {
        toast.error(`Failed to apply action: ${result.error}`);
        return;
      }
      toast.success("Moderation action applied");
      await loadContentReports(reportFilter);
      setSelectedReport(null);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Start AI Scan with Server-Sent Events
  const handleRunAiScan = useCallback(() => {
    if (isScanActive) return;

    setIsScanActive(true);
    setScanProgress(null);
    setScanResults([]);

    const eventSource = new EventSource("/api/admin/moderation/scan-stream");
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed: ScanEvent = JSON.parse(event.data);

        switch (parsed.type) {
          case "start":
            setScanProgress({
              current: 0,
              total: parsed.data.totalItems || 0,
              percentComplete: 0,
              reportsProcessed: 0,
              projectsProcessed: 0,
            });
            toast.info(
              `Starting AI scan: ${parsed.data.totalReports} reports, ${parsed.data.totalProjects} projects`,
            );
            break;

          case "analyzing":
            setScanProgress((prev) =>
              prev
                ? {
                    ...prev,
                    currentItem: parsed.data.itemTitle,
                    currentItemType: parsed.data.itemType,
                    current: parsed.data.current || prev.current,
                  }
                : null,
            );
            break;

          case "progress":
            setScanProgress((prev) =>
              prev
                ? {
                    ...prev,
                    current: parsed.data.processed || 0,
                    percentComplete: parsed.data.percentComplete || 0,
                  }
                : null,
            );
            break;

          case "result":
            setScanResults((prev) => [
              ...prev,
              {
                itemType: parsed.data.itemType || "unknown",
                itemId: parsed.data.itemId || "",
                success: parsed.data.success || false,
                flagged: parsed.data.flagged,
                result: parsed.data.result as
                  AiMetadata | Record<string, unknown>,
                error: parsed.data.error,
              },
            ]);
            if (parsed.data.itemType === "report") {
              setScanProgress((prev) =>
                prev
                  ? { ...prev, reportsProcessed: prev.reportsProcessed + 1 }
                  : null,
              );
            } else {
              setScanProgress((prev) =>
                prev
                  ? { ...prev, projectsProcessed: prev.projectsProcessed + 1 }
                  : null,
              );
            }
            break;

          case "complete":
            toast.success(parsed.data.message || "AI scan completed");
            eventSource.close();
            eventSourceRef.current = null;
            // Refresh data
            loadContentReports(reportFilter);
            loadFlaggedContent(flaggedFilter);
            // Keep dialog open briefly to show completion
            setTimeout(() => {
              setIsScanActive(false);
              setScanProgress(null);
            }, 2000);
            break;

          case "error":
            toast.error(parsed.data.message || "AI scan failed");
            eventSource.close();
            eventSourceRef.current = null;
            setIsScanActive(false);
            break;
        }
      } catch (e) {
        safeConsole.error("Failed to parse SSE event:", e);
      }
    };

    eventSource.onerror = () => {
      toast.error("Connection to AI scan lost");
      eventSource.close();
      eventSourceRef.current = null;
      setIsScanActive(false);
    };
  }, [isScanActive, reportFilter, flaggedFilter]);

  const handleReportAiApproval = async (report: ContentReport) => {
    if (!report.ai_metadata) {
      toast.error("No AI recommendation available");
      return;
    }
    const suggestedStatus = report.ai_metadata.suggestedStatus;
    const validStatuses: ReportsFilter[] = [
      "pending",
      "under_review",
      "resolved",
      "dismissed",
    ];
    const action = validStatuses.includes(suggestedStatus as ReportsFilter)
      ? (suggestedStatus as ReportsFilter)
      : "under_review";
    await handleReportStatusChange(
      report.id,
      action,
      "Approved AI recommendation",
    );
  };

  return {
    flaggedContent,
    contentReports,
    flaggedFilter,
    setFlaggedFilter,
    reportFilter,
    setReportFilter,
    isFlaggedLoading,
    isReportsLoading,
    isActionLoading,
    selectedFlag,
    setSelectedFlag,
    selectedReport,
    setSelectedReport,
    isScanActive,
    setIsScanActive,
    scanProgress,
    scanResults,
    loadFlaggedContent,
    loadContentReports,
    handleFlagStatusUpdate,
    handleReportStatusChange,
    handleRunAiReviewForFlag,
    handleManualReportAction,
    handleRunAiScan,
    handleReportAiApproval,
  };
}
