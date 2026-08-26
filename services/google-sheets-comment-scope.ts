import { createHash } from "node:crypto";
import type { CsfDriveCommentThread } from "./google-drive";
import type { CsfSheetAnchoredCommentThread } from "./google-sheets-anchored-comments";
import type { CsfSheetSourceSnapshot } from "./google-sheets-csf";

export function scopeCsfThreadedCommentsToSnapshots(
  snapshots: readonly CsfSheetSourceSnapshot[],
  threadedComments: readonly CsfDriveCommentThread[],
) {
  return {
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      threadedCommentsByRow: {},
      threadedCommentCount: 0,
      unmatchedThreadedCommentCount: 0,
    })),
    // Drive's legacy native-Sheets anchors are opaque. Quoted text cannot
    // prove a tab or cell, so legacy threads remain workbook-level evidence.
    unmatchedThreadedCommentCount: threadedComments.length,
  };
}

export function attachAnchoredCommentsToSnapshots(
  snapshots: readonly CsfSheetSourceSnapshot[],
  comments: readonly CsfSheetAnchoredCommentThread[],
) {
  const commentsBySnapshot = snapshots.map(
    () => ({}) as CsfSheetSourceSnapshot["threadedCommentsByRow"],
  );
  const matchedCounts = snapshots.map(() => 0);
  let unmatchedThreadedCommentCount = 0;

  for (const comment of comments) {
    // A multi-cell anchor is meaningful evidence, but it cannot be assigned to
    // one activity cell without guessing. Keep it for manual placement.
    if (
      comment.endRowIndex !== comment.startRowIndex + 1 ||
      comment.endColumnIndex !== comment.startColumnIndex + 1
    ) {
      unmatchedThreadedCommentCount += 1;
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
      unmatchedThreadedCommentCount += 1;
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
      return {
        ...snapshot,
        contentHash: createHash("sha256")
          .update(snapshot.contentHash)
          .update("\u001f")
          .update(JSON.stringify(scoped))
          .digest("hex"),
        threadedCommentsByRow: scoped,
        threadedCommentCount: matchedCounts[index],
        unmatchedThreadedCommentCount: 0,
      };
    }),
    unmatchedThreadedCommentCount,
  };
}
