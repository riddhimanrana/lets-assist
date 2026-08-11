export type SpreadsheetReplaceStage = "write" | "clear";

export type SpreadsheetReplaceResult =
  { success: true } | { success: false; stage: SpreadsheetReplaceStage };

type SpreadsheetReplaceOperations = {
  write: () => Promise<boolean>;
  clear: (range: string) => Promise<boolean>;
};

export async function writeThenClearStaleSpreadsheetValues(
  staleRanges: readonly string[],
  operations: SpreadsheetReplaceOperations,
): Promise<SpreadsheetReplaceResult> {
  const written = await operations.write();
  if (!written) {
    return { success: false, stage: "write" };
  }

  for (const range of staleRanges) {
    const cleared = await operations.clear(range);
    if (!cleared) {
      return { success: false, stage: "clear" };
    }
  }

  return { success: true };
}
