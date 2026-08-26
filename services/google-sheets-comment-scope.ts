import type { CsfDriveCommentThread } from "./google-drive";
import type { CsfSheetSourceSnapshot } from "./google-sheets-csf";

const DRIVE_QUOTED_TEXT_ENTITIES = new Map<string, string>([
  ["&nbsp;", " "],
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
]);

export function extractDriveQuotedText(markup: string) {
  let result = "";
  let cursor = 0;

  while (cursor < markup.length) {
    const character = markup[cursor];
    if (character === "<") {
      const tagEnd = markup.indexOf(">", cursor + 1);
      if (tagEnd === -1) {
        result += character;
        cursor += 1;
        continue;
      }

      let tagCursor = cursor + 1;
      while (
        tagCursor < tagEnd &&
        (markup[tagCursor] === " " || markup[tagCursor] === "/")
      ) {
        tagCursor += 1;
      }
      let tagName = "";
      while (tagCursor < tagEnd) {
        const codePoint = markup.charCodeAt(tagCursor);
        const isAsciiLetter =
          (codePoint >= 65 && codePoint <= 90) ||
          (codePoint >= 97 && codePoint <= 122);
        if (!isAsciiLetter) break;
        tagName += markup[tagCursor].toLowerCase();
        tagCursor += 1;
      }
      if (tagName === "br") result += "\n";
      cursor = tagEnd + 1;
      continue;
    }

    if (character === "&") {
      const entityEnd = markup.indexOf(";", cursor + 1);
      if (entityEnd !== -1 && entityEnd - cursor <= 6) {
        const entity = markup.slice(cursor, entityEnd + 1).toLowerCase();
        const decoded = DRIVE_QUOTED_TEXT_ENTITIES.get(entity);
        if (decoded !== undefined) {
          result += decoded;
          cursor = entityEnd + 1;
          continue;
        }
      }
    }

    result += character;
    cursor += 1;
  }

  return result.trim();
}

export function scopeCsfThreadedCommentsToSnapshots(
  snapshots: readonly CsfSheetSourceSnapshot[],
  threadedComments: readonly CsfDriveCommentThread[],
) {
  const commentsBySnapshot = snapshots.map(
    () => ({}) as CsfSheetSourceSnapshot["threadedCommentsByRow"],
  );
  const matchedCounts = snapshots.map(() => 0);
  let unmatchedThreadedCommentCount = 0;

  for (const comment of threadedComments) {
    const quotedText = comment.quotedHtml
      ? extractDriveQuotedText(comment.quotedHtml)
      : "";
    if (!quotedText) {
      unmatchedThreadedCommentCount += 1;
      continue;
    }

    const matches: Array<{
      snapshotIndex: number;
      sourceRowNumber: number;
      columnNumber: number;
    }> = [];
    snapshots.forEach((snapshot, snapshotIndex) => {
      snapshot.rows.forEach((row) => {
        row.values.forEach((value, columnOffset) => {
          if (String(value ?? "").trim() !== quotedText) return;
          matches.push({
            snapshotIndex,
            sourceRowNumber: row.sourceRowNumber,
            columnNumber: snapshot.requestedRange.startColumn + columnOffset,
          });
        });
      });
    });

    if (matches.length !== 1) {
      unmatchedThreadedCommentCount += 1;
      continue;
    }

    const [{ snapshotIndex, sourceRowNumber, columnNumber }] = matches;
    (commentsBySnapshot[snapshotIndex][sourceRowNumber] ??= []).push({
      columnNumber,
      content: comment.content,
      replies: comment.replies.map((reply) => reply.content),
      resolved: comment.resolved,
    });
    matchedCounts[snapshotIndex] += 1;
  }

  return {
    snapshots: snapshots.map((snapshot, index) => ({
      ...snapshot,
      threadedCommentsByRow: commentsBySnapshot[index],
      threadedCommentCount: matchedCounts[index],
      unmatchedThreadedCommentCount: 0,
    })),
    unmatchedThreadedCommentCount,
  };
}
