import { logError } from "@/lib/logger";
import { GOOGLE_SHEETS_API } from "./google-drive";
import type { CsfSheetSourceUnavailableReason } from "./google-sheets-csf";

export type CsfSheetAnchoredCommentThread = {
  id: string;
  anchorId: string;
  sheetId: number;
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
  content: string;
  replies: string[];
  resolved: boolean;
};

export type CsfSheetAnchoredCommentResult =
  | {
      status: "ok";
      comments: CsfSheetAnchoredCommentThread[];
      unmatchedCommentCount: number;
    }
  | {
      status: "unavailable";
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    };

type ProviderRange = {
  sheetId?: unknown;
  startRowIndex?: unknown;
  endRowIndex?: unknown;
  startColumnIndex?: unknown;
  endColumnIndex?: unknown;
};

function boundedIndex(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 10_000_000
    ? value
    : null;
}

/**
 * Read native Sheets comment threads with their provider-owned grid anchors.
 *
 * The endpoint is a Google Workspace Developer Preview. Filtering by the exact
 * import ranges means Google omits unanchored and out-of-scope threads before
 * returning evidence. Callers still verify every coordinate against the
 * bounded snapshots before attaching it to a row.
 */
export async function getGoogleSheetAnchoredCommentThreads(
  accessToken: string,
  spreadsheetId: string,
  ranges: readonly string[],
): Promise<CsfSheetAnchoredCommentResult> {
  const params = new URLSearchParams({
    commentsViewMode: "COMMENTS_VIEW_MODE_INCLUDED",
    fields:
      "comments(commentId,anchorId,headPost(content,deleted),replies(content,deleted),status),sheets(properties(sheetId,title),commentAnchors(anchorId,range))",
  });
  for (const range of ranges) params.append("ranges", range);

  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (error) {
    logError("Exception while reading Google Sheets comment anchors", error);
    return {
      status: "unavailable",
      reason: "unavailable",
      message: "The selected Sheet comment anchors could not be inspected.",
    };
  }

  if (!response.ok) {
    logError(
      "Failed to read Google Sheets comment anchors",
      new Error(`Sheets returned ${response.status}`),
      { status: response.status },
    );
    return {
      status: "unavailable",
      reason:
        response.status === 401
          ? "reconnect_required"
          : response.status === 404
            ? "not_found"
            : response.status === 429
              ? "rate_limited"
              : "unavailable",
      message:
        response.status === 401
          ? "Reconnect Google Sheets so comment anchors can be imported."
          : "Exact Google Sheets comment anchors are unavailable.",
    };
  }

  const data = (await response.json()) as {
    sheets?: Array<{
      commentAnchors?: Array<{ anchorId?: unknown; range?: ProviderRange }>;
    }>;
    comments?: Array<{
      commentId?: unknown;
      anchorId?: unknown;
      headPost?: { content?: unknown; deleted?: unknown };
      replies?: Array<{ content?: unknown; deleted?: unknown }>;
      status?: unknown;
    }>;
  };
  const anchors = new Map<
    string,
    Omit<
      CsfSheetAnchoredCommentThread,
      "id" | "anchorId" | "content" | "replies" | "resolved"
    >
  >();
  for (const sheet of data.sheets ?? []) {
    for (const anchor of sheet.commentAnchors ?? []) {
      if (typeof anchor.anchorId !== "string" || !anchor.range) continue;
      const sheetId = boundedIndex(anchor.range.sheetId);
      const startRowIndex = boundedIndex(anchor.range.startRowIndex);
      const endRowIndex = boundedIndex(anchor.range.endRowIndex);
      const startColumnIndex = boundedIndex(anchor.range.startColumnIndex);
      const endColumnIndex = boundedIndex(anchor.range.endColumnIndex);
      if (
        sheetId === null ||
        startRowIndex === null ||
        endRowIndex === null ||
        startColumnIndex === null ||
        endColumnIndex === null ||
        endRowIndex <= startRowIndex ||
        endColumnIndex <= startColumnIndex
      ) {
        continue;
      }
      anchors.set(anchor.anchorId, {
        sheetId,
        startRowIndex,
        endRowIndex,
        startColumnIndex,
        endColumnIndex,
      });
    }
  }

  const comments: CsfSheetAnchoredCommentThread[] = [];
  let unmatchedCommentCount = 0;
  for (const comment of data.comments ?? []) {
    if (comment.headPost?.deleted === true) continue;
    if (
      typeof comment.commentId !== "string" ||
      typeof comment.anchorId !== "string" ||
      typeof comment.headPost?.content !== "string"
    ) {
      unmatchedCommentCount += 1;
      continue;
    }
    const anchor = anchors.get(comment.anchorId);
    if (!anchor) {
      unmatchedCommentCount += 1;
      continue;
    }
    comments.push({
      id: comment.commentId.slice(0, 2048),
      anchorId: comment.anchorId.slice(0, 2048),
      ...anchor,
      content: comment.headPost.content.slice(0, 16_384),
      replies: (comment.replies ?? []).flatMap((reply) =>
        reply.deleted !== true && typeof reply.content === "string"
          ? [reply.content.slice(0, 16_384)]
          : [],
      ),
      resolved: comment.status === "RESOLVED",
    });
  }

  return { status: "ok", comments, unmatchedCommentCount };
}
