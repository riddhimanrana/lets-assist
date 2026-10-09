import "server-only";

import type { getAdminClient } from "@/lib/supabase/admin";
import { inspectSpreadsheet } from "@/services/google-sheets-report";

/**
 * Why the saved destination cannot be written to, when an admin has to act.
 * There is no column for this yet, so it is read from Google each time the
 * card loads.
 */
export type SheetDestinationProblem =
  | { kind: "reselect" }
  | { kind: "tab_missing"; tabName: string; tabs: string[] };

/**
 * Checks the saved spreadsheet and tab with the sync owner's token. Returns
 * null when the destination is fine, and also when Google could not answer,
 * so a slow or failing request never shows up as a broken destination.
 */
export async function probeSheetDestination(
  accessToken: string,
  sheetId: string,
  tabName: string,
): Promise<SheetDestinationProblem | null> {
  const inspection = await inspectSpreadsheet(accessToken, sheetId);
  if (!inspection.ok) {
    // Under the drive.file scope, a file this Google account did not pick or
    // create answers as forbidden or not found.
    return inspection.reason === "access_denied" ||
      inspection.reason === "not_found"
      ? { kind: "reselect" }
      : null;
  }
  return inspection.metadata.tabs.includes(tabName)
    ? null
    : { kind: "tab_missing", tabName, tabs: inspection.metadata.tabs };
}

/**
 * Run after the sync owner changes. Sheets access belongs to the Google
 * account that picked the file, so a new owner usually cannot open it. When
 * that is the case, automatic sync is turned off so the worker does not fail
 * on every run, and the cards ask the new owner to choose the file again.
 */
export async function flagSheetSyncAfterOwnerChange({
  supabase,
  organizationId,
  sheetId,
  accessToken,
}: {
  supabase: ReturnType<typeof getAdminClient>;
  organizationId: string;
  sheetId: string;
  accessToken: string;
}): Promise<{ needsReselect: boolean }> {
  const inspection = await inspectSpreadsheet(accessToken, sheetId);
  const needsReselect =
    !inspection.ok &&
    (inspection.reason === "access_denied" ||
      inspection.reason === "not_found");
  if (needsReselect) {
    await supabase
      .from("organization_sheet_syncs")
      .update({ auto_sync: false, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);
  }
  return { needsReselect };
}
