"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  reselectSheetDestination,
  syncSheetNow,
  updateSheetSyncConfig,
  type SheetDestinationProblem,
} from "../sheets-actions";
import { useSheetPicker } from "./useSheetPicker";

const MAX_TAB_CHOICES = 12;

/**
 * Shown when the saved spreadsheet or tab can no longer be written to. It
 * says what is wrong and, for an admin who can fix it here, offers the fix.
 */
export function SheetSyncAttention({
  organizationId,
  problem,
  isAdmin,
  canPick,
  onChanged,
}: {
  organizationId: string;
  problem: SheetDestinationProblem;
  isAdmin: boolean;
  /** The viewer has their own Google account connected with Sheets access. */
  canPick: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);

  const picker = useSheetPicker({
    organizationId,
    onPicked: async (sheetId) => {
      setWorking(true);
      const result = await reselectSheetDestination(organizationId, sheetId);
      if (result.success) {
        toast.success(
          result.autoSyncOff
            ? "Spreadsheet selected and synced. Automatic sync is off. Turn it back on in settings if you want it."
            : "Spreadsheet selected and synced.",
        );
      } else {
        toast.error(result.error || "Failed to select the spreadsheet");
      }
      await onChanged();
      setWorking(false);
    },
    onError: (message) => toast.error(message),
  });

  const handlePickTab = async (tabName: string) => {
    setWorking(true);
    const saved = await updateSheetSyncConfig(organizationId, { tabName });
    if (!saved.success) {
      toast.error(saved.error || "Failed to save the tab");
    } else {
      const synced = await syncSheetNow(organizationId);
      if (synced.success) {
        toast.success(`Now syncing to the tab "${tabName}"`);
      } else {
        toast.error(synced.error || "Tab saved, but the sync failed");
      }
    }
    await onChanged();
    setWorking(false);
  };

  if (problem.kind === "reselect") {
    return (
      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>Choose the spreadsheet again</AlertTitle>
        <AlertDescription>
          <p>
            The connected Google account cannot open this spreadsheet. Google
            gives access to the person who picks a file, so it has to be picked
            again before anything can sync.{" "}
            {isAdmin
              ? canPick
                ? "Whoever picks it becomes the sync owner."
                : "Connect your Google account with Sheets access in settings, then choose the file."
              : "Ask an organization admin to choose it again in settings."}
          </p>
          {isAdmin && canPick ? (
            <Button
              variant="outline"
              onClick={picker.openPicker}
              disabled={working || picker.pickerLoading}
            >
              {working
                ? "Saving..."
                : picker.pickerLoading
                  ? "Opening..."
                  : "Choose spreadsheet"}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  const tabs = problem.tabs.slice(0, MAX_TAB_CHOICES);
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>The tab &quot;{problem.tabName}&quot; is missing</AlertTitle>
      <AlertDescription>
        <p>
          It was renamed or deleted in the spreadsheet, so the report has
          nowhere to go.{" "}
          {isAdmin
            ? tabs.length > 0
              ? "Pick the tab to write to."
              : "Set the tab name again in settings."
            : "Ask an organization admin to pick a tab in settings."}
        </p>
        {isAdmin && tabs.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Tabs in this spreadsheet"
          >
            {tabs.map((tab) => (
              <Button
                key={tab}
                variant="outline"
                onClick={() => handlePickTab(tab)}
                disabled={working}
              >
                {tab}
              </Button>
            ))}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
