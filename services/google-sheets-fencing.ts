import { logError } from "@/lib/logger";
import {
  GOOGLE_SHEETS_API,
  getGoogleDriveFileMetadata,
  type CsfDriveFileMetadata,
  type SpreadsheetValueInputOption,
} from "./google-drive";
import {
  getCsfSheetSourceSnapshot,
  type CsfSheetSourceUnavailableReason,
  type CsfSheetSourceSnapshot,
} from "./google-sheets-csf";

/* -------------------------------------------------------------------------
 * Fenced multi-read acquisition.
 *
 * A preview reads a spreadsheet three ways per tab -- values, workbook metadata,
 * grid evidence -- and a multi-tab import repeats that per tab. Those are
 * separate HTTP requests against a document anybody with edit access can change
 * between them. Nothing prevented a source from being edited mid-read, and the
 * result was a provenance bundle that described no state the workbook was ever
 * actually in: values from before an edit, hidden-row evidence from after it,
 * and one content digest asserting they belong together.
 *
 * Fencing reads the Drive `version` and modified time before the first read and
 * again after the last, and refuses the acquisition if either moved. This cannot
 * make the reads atomic -- only the provider could -- but it does turn a silent
 * inconsistency into an explicit, retryable failure.
 *
 * Both coordinates are required, on both sides. `modifiedTime` alone has
 * one-second granularity, so an edit landing inside the same second as the
 * opening read is invisible to it; `version` advances on every server-side
 * change and is what makes that edit detectable. A fence missing either one
 * cannot show stability, so it is unavailable rather than assumed stable.
 * ---------------------------------------------------------------------------
 */

export type CsfSheetSourceFence = {
  /** The provider's exact `version` string. Never parsed as a number. */
  version: string | null;
  modifiedAt: string | null;
};

export type CsfFencedSheetRequest = {
  rangeA1: string;
  fallbackTabName: string;
};

export type CsfFencedSheetAcquisitionResult =
  | {
      status: "ok";
      fence: CsfSheetSourceFence;
      driveFile: CsfDriveFileMetadata;
      snapshots: CsfSheetSourceSnapshot[];
      attempts: number;
    }
  | {
      status: "unavailable";
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    }
  | {
      status: "drift";
      message: string;
      before: CsfSheetSourceFence;
      after: CsfSheetSourceFence;
      attempts: number;
    };

function fenceOf(metadata: CsfDriveFileMetadata): CsfSheetSourceFence {
  return {
    version: metadata.version ?? null,
    modifiedAt: metadata.modifiedTime ?? null,
  };
}

/** Both coordinates, exactly. Either missing means stability cannot be shown. */
function fenceIsUsable(fence: CsfSheetSourceFence) {
  return fence.version !== null && fence.modifiedAt !== null;
}

/**
 * Exact agreement on both coordinates.
 *
 * An unchanged `modifiedAt` beside a changed `version` is the case this exists
 * for: the file was edited inside the same timestamp granule as the opening
 * read, and only the version says so.
 */
function fencesAgree(before: CsfSheetSourceFence, after: CsfSheetSourceFence) {
  return (
    before.version === after.version && before.modifiedAt === after.modifiedAt
  );
}

const UNUSABLE_FENCE_MESSAGE =
  "The source file reports no version or modification time, so a consistent read cannot be proven.";

export async function acquireFencedCsfSheetSnapshots(
  accessToken: string,
  spreadsheetId: string,
  requests: readonly CsfFencedSheetRequest[],
  options: { maxAttempts?: number } = {},
): Promise<CsfFencedSheetAcquisitionResult> {
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 2));
  let lastBefore: CsfSheetSourceFence = { version: null, modifiedAt: null };
  let lastAfter: CsfSheetSourceFence = { version: null, modifiedAt: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = await getGoogleDriveFileMetadata(accessToken, spreadsheetId);
    if (before.accessState !== "accessible") {
      return {
        status: "unavailable",
        reason:
          before.accessState === "reconnect_required"
            ? "reconnect_required"
            : before.accessState === "not_found" ||
                before.accessState === "trashed"
              ? "not_found"
              : "unavailable",
        message:
          "The source file could not be read before importing; no rows were treated as empty.",
      };
    }
    const beforeFence = fenceOf(before);
    if (!fenceIsUsable(beforeFence)) {
      // Without both the provider version and a modified time there is nothing
      // to compare against, so stability cannot be shown. Reporting success here
      // would be asserting something unproven about a student-data import.
      return {
        status: "unavailable",
        reason: "unavailable",
        message: UNUSABLE_FENCE_MESSAGE,
      };
    }

    const snapshots: CsfSheetSourceSnapshot[] = [];
    let failed: {
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    } | null = null;
    for (const request of requests) {
      const snapshot = await getCsfSheetSourceSnapshot(
        accessToken,
        spreadsheetId,
        request.rangeA1,
        request.fallbackTabName,
      );
      if (snapshot.status !== "ok") {
        failed = { reason: snapshot.reason, message: snapshot.message };
        break;
      }
      snapshots.push(snapshot);
    }
    if (failed) {
      return {
        status: "unavailable",
        reason: failed.reason,
        message: failed.message,
      };
    }

    const after = await getGoogleDriveFileMetadata(accessToken, spreadsheetId);
    if (after.accessState !== "accessible") {
      return {
        status: "unavailable",
        reason:
          after.accessState === "reconnect_required"
            ? "reconnect_required"
            : after.accessState === "not_found" ||
                after.accessState === "trashed"
              ? "not_found"
              : "unavailable",
        message:
          "The source file could not be re-checked after reading; no rows were treated as empty.",
      };
    }
    const afterFence = fenceOf(after);
    // The closing fence is held to the same requirement as the opening one.
    //
    // Both coordinates are also part of what makes a Drive answer `accessible`,
    // so in practice the reader above refuses an incomplete one first. This is
    // the second line of the same rule, kept because `fencesAgree` must never be
    // reached with a null on either side: a null-against-value comparison
    // reports "drift", which reads as "the file changed" when what actually
    // happened is that nothing was proven.
    if (!fenceIsUsable(afterFence)) {
      return {
        status: "unavailable",
        reason: "unavailable",
        message: UNUSABLE_FENCE_MESSAGE,
      };
    }
    lastBefore = beforeFence;
    lastAfter = afterFence;

    if (fencesAgree(beforeFence, afterFence)) {
      return {
        status: "ok",
        fence: afterFence,
        driveFile: after,
        snapshots,
        attempts: attempt,
      };
    }
  }

  return {
    status: "drift",
    message:
      "The source file changed while it was being read. Nothing was imported; preview it again.",
    before: lastBefore,
    after: lastAfter,
    attempts: maxAttempts,
  };
}

export async function appendSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: Array<Array<string | number | boolean | null>>,
  valueInputOption: SpreadsheetValueInputOption = "USER_ENTERED",
): Promise<boolean> {
  if (rows.length === 0) return true;

  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
        range,
      )}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range,
          majorDimension: "ROWS",
          values: rows,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to append Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range,
        rows_count: rows.length,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError("Exception while appending Google spreadsheet values", error, {
      sheet_id: sheetId,
      range,
      rows_count: rows.length,
    });
    return false;
  }
}
