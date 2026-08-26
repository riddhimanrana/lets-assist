import { createHash } from "node:crypto";
import type { CsfDriveCommentThread } from "./google-drive";
import type { CsfSheetAnchoredCommentThread } from "./google-sheets-anchored-comments";
import type {
  CsfSheetSourceSnapshot,
  CsfSheetUnmatchedThreadedComment,
} from "./google-sheets-csf";

function legacyEvidence(
  comment: CsfDriveCommentThread,
): CsfSheetUnmatchedThreadedComment {
  return {
    provider: "drive_legacy",
    id: comment.id,
    anchorId: null,
    anchor: comment.anchor,
    quotedHtml: comment.quotedHtml,
    sheetId: null,
    startRowIndex: null,
    endRowIndex: null,
    startColumnIndex: null,
    endColumnIndex: null,
    content: comment.content,
    replies: comment.replies.map((reply) => reply.content),
    resolved: comment.resolved,
  };
}

function anchoredEvidence(
  comment: CsfSheetAnchoredCommentThread,
): CsfSheetUnmatchedThreadedComment {
  return {
    provider: "sheets_anchor",
    id: comment.id,
    anchorId: comment.anchorId,
    anchor: null,
    quotedHtml: null,
    sheetId: comment.sheetId,
    startRowIndex: comment.startRowIndex,
    endRowIndex: comment.endRowIndex,
    startColumnIndex: comment.startColumnIndex,
    endColumnIndex: comment.endColumnIndex,
    content: comment.content,
    replies: comment.replies,
    resolved: comment.resolved,
  };
}

function withUnmatchedEvidence(
  snapshot: CsfSheetSourceSnapshot,
  unmatchedThreadedComments: CsfSheetUnmatchedThreadedComment[],
) {
  return {
    ...snapshot,
    contentHash: createHash("sha256")
      .update(snapshot.contentHash)
      .update("\u001f")
      .update(JSON.stringify(unmatchedThreadedComments))
      .digest("hex"),
    unmatchedThreadedCommentCount: unmatchedThreadedComments.length,
    unmatchedThreadedComments,
  };
}

export function scopeCsfThreadedCommentsToSnapshots(
  snapshots: readonly CsfSheetSourceSnapshot[],
  threadedComments: readonly CsfDriveCommentThread[],
) {
  const unmatchedThreadedComments = threadedComments.map(legacyEvidence);
  return {
    snapshots: snapshots.map((snapshot) =>
      withUnmatchedEvidence(
        {
          ...snapshot,
          threadedCommentsByRow: {},
          threadedCommentCount: 0,
        },
        unmatchedThreadedComments,
      ),
    ),
    // Drive's legacy native-Sheets anchors are opaque. Quoted text cannot
    // prove a tab or cell, so legacy threads remain workbook-level evidence.
    unmatchedThreadedCommentCount: threadedComments.length,
    unmatchedThreadedComments,
  };
}

export function attachAnchoredCommentsToSnapshots(
  snapshots: readonly CsfSheetSourceSnapshot[],
  comments: readonly CsfSheetAnchoredCommentThread[],
  providerUnmatchedComments: readonly CsfSheetUnmatchedThreadedComment[] = [],
) {
  const commentsBySnapshot = snapshots.map(
    () => ({}) as CsfSheetSourceSnapshot["threadedCommentsByRow"],
  );
  const matchedCounts = snapshots.map(() => 0);
  const unmatchedThreadedComments = [...providerUnmatchedComments];

  for (const comment of comments) {
    // A multi-cell anchor is meaningful evidence, but it cannot be assigned to
    // one activity cell without guessing. Keep it for manual placement.
    if (
      comment.endRowIndex !== comment.startRowIndex + 1 ||
      comment.endColumnIndex !== comment.startColumnIndex + 1
    ) {
      unmatchedThreadedComments.push(anchoredEvidence(comment));
      continue;
    }
    const sourceRowNumber = comment.startRowIndex + 1;
    const columnNumber = comment.startColumnIndex + 1;
    const matches = snapshots.flatMap((snapshot, snapshotIndex) =>
      snapshot.selectedTab.sheetId === comment.sheetId &&
      sourceRowNumber >= snapshot.requestedRange.startRow &&
      sourceRowNumber <= snapshot.requestedRange.endRow &&
      columnNumber >= snapshot.requestedRange.startColumn &&
      columnNumber <= snapshot.requestedRange.endColumn
        ? [{ snapshotIndex }]
        : [],
    );
    if (matches.length !== 1) {
      unmatchedThreadedComments.push(anchoredEvidence(comment));
      continue;
    }
    const [{ snapshotIndex }] = matches;
    (commentsBySnapshot[snapshotIndex][sourceRowNumber] ??= []).push({
      columnNumber,
      content: comment.content,
      replies: comment.replies,
      resolved: comment.resolved,
    });
    matchedCounts[snapshotIndex] += 1;
  }

  return {
    snapshots: snapshots.map((snapshot, index) => {
      const scoped = commentsBySnapshot[index];
      return withUnmatchedEvidence(
        {
          ...snapshot,
          contentHash: createHash("sha256")
            .update(snapshot.contentHash)
            .update("\u001f")
            .update(JSON.stringify(scoped))
            .digest("hex"),
          threadedCommentsByRow: scoped,
          threadedCommentCount: matchedCounts[index],
        },
        unmatchedThreadedComments,
      );
    }),
    unmatchedThreadedCommentCount: unmatchedThreadedComments.length,
    unmatchedThreadedComments,
  };
}
