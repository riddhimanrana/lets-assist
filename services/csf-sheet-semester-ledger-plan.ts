export type SemesterLedgerSlot = {
  columnIndex: number;
  value: string;
  evidenceId: string;
};

export type SemesterLedgerRow = {
  rowIndex: number;
  sourceKey: string;
  cells: ReadonlyArray<string | number | null>;
};

export type SemesterLedgerPlanInput = {
  destinationFileId: string;
  originalSourceFileId: string;
  destinationCopiedFromFileId: string;
  profileId: string;
  reviewedLinkProfileId: string;
  reviewedLinkSourceKey: string;
  reviewedLinkSourceFileId: string;
  destinationRows: ReadonlyArray<SemesterLedgerRow>;
  slots: ReadonlyArray<SemesterLedgerSlot>;
  firstWritableColumn: number;
  lastWritableColumn: number;
};

export type SemesterLedgerCellChange = {
  rowIndex: number;
  columnIndex: number;
  expectedValue: string;
  value: string;
  evidenceId: string;
};

export type SemesterLedgerPlan = {
  rowIndex: number;
  changes: SemesterLedgerCellChange[];
};

// The caller must hold a reviewed source-row link and verify a copied destination.
// It must re-read every expected cell before sending this plan to Google Sheets.
export function planSemesterLedgerRow(input: SemesterLedgerPlanInput): SemesterLedgerPlan {
  if (
    !input.destinationFileId ||
    !input.originalSourceFileId ||
    input.destinationFileId === input.originalSourceFileId ||
    input.destinationCopiedFromFileId !== input.originalSourceFileId
  ) {
    throw new Error("Choose a verified, separate Let's Assist destination workbook.");
  }
  if (
    !input.profileId ||
    input.reviewedLinkProfileId !== input.profileId ||
    !input.reviewedLinkSourceKey ||
    input.reviewedLinkSourceFileId !== input.originalSourceFileId
  ) {
    throw new Error("A reviewed source-row link is required before writing a roster row.");
  }
  if (
    !Number.isInteger(input.firstWritableColumn) ||
    !Number.isInteger(input.lastWritableColumn) ||
    input.firstWritableColumn < 0 ||
    input.lastWritableColumn < input.firstWritableColumn
  ) {
    throw new Error("The semester ledger columns need an explicit mapping.");
  }

  const matches = input.destinationRows.filter(
    (row) => row.sourceKey === input.reviewedLinkSourceKey,
  );
  if (matches.length !== 1 || !Number.isInteger(matches[0].rowIndex) || matches[0].rowIndex < 0) {
    throw new Error("The reviewed roster row is missing or ambiguous in the destination.");
  }

  const row = matches[0];
  const columns = new Set<number>();
  const changes: SemesterLedgerCellChange[] = [];
  for (const slot of input.slots) {
    if (
      !Number.isInteger(slot.columnIndex) ||
      slot.columnIndex < input.firstWritableColumn ||
      slot.columnIndex > input.lastWritableColumn ||
      columns.has(slot.columnIndex) ||
      !slot.evidenceId.trim() ||
      !slot.value.trim()
    ) {
      throw new Error("A ledger value has no unique mapped column or source evidence.");
    }
    columns.add(slot.columnIndex);
    const raw = row.cells[slot.columnIndex];
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      throw new Error("The destination contains an invalid numeric cell.");
    }
    const existing = raw == null ? "" : String(raw);
    if (existing === slot.value) continue;
    if (existing !== "") {
      throw new Error("A destination cell already contains different data. Review it before replacing it.");
    }
    changes.push({
      rowIndex: row.rowIndex,
      columnIndex: slot.columnIndex,
      expectedValue: existing,
      value: slot.value,
      evidenceId: slot.evidenceId,
    });
  }
  return { rowIndex: row.rowIndex, changes };
}
