export type SemesterLedgerSlot = {
  columnIndex: number;
  value: string;
  evidenceId: string;
};

export type VerifiedSemesterActivity = {
  title: string;
  points: number;
  evidenceId: string;
};

export type VerifiedMeetingMark = {
  meetingId: string;
  mark: "X" | "E" | "N/A";
  evidenceId: string;
};

export type SemesterLedgerProjectionInput = {
  activityColumns: ReadonlyArray<number>;
  meetingColumns: ReadonlyArray<{ meetingId: string; columnIndex: number }>;
  activities: ReadonlyArray<VerifiedSemesterActivity>;
  meetingMarks: ReadonlyArray<VerifiedMeetingMark>;
};

// Historical point awards are repeated by point, as in the chapter's F25/S26/F26
// activity columns. Missing meeting evidence leaves that meeting cell untouched.
export function projectSemesterLedgerSlots(
  input: SemesterLedgerProjectionInput,
): SemesterLedgerSlot[] {
  const slots: SemesterLedgerSlot[] = [];
  let activityIndex = 0;
  for (const activity of input.activities) {
    if (
      !activity.title.trim() ||
      !activity.evidenceId.trim() ||
      !Number.isSafeInteger(activity.points) ||
      activity.points <= 0 ||
      activityIndex + activity.points > input.activityColumns.length
    ) {
      throw new Error("An activity lacks evidence or exceeds the semester ledger capacity.");
    }
    for (let point = 0; point < activity.points; point += 1) {
      slots.push({
        columnIndex: input.activityColumns[activityIndex],
        value: activity.title.trim(),
        evidenceId: activity.evidenceId,
      });
      activityIndex += 1;
    }
  }

  const meetingColumns = new Map<string, number>();
  for (const meeting of input.meetingColumns) {
    if (!meeting.meetingId || meetingColumns.has(meeting.meetingId)) {
      throw new Error("The meeting column mapping is incomplete or duplicated.");
    }
    meetingColumns.set(meeting.meetingId, meeting.columnIndex);
  }
  const seenMarks = new Set<string>();
  for (const mark of input.meetingMarks) {
    const columnIndex = meetingColumns.get(mark.meetingId);
    if (
      columnIndex === undefined ||
      seenMarks.has(mark.meetingId) ||
      !mark.evidenceId.trim() ||
      !["X", "E", "N/A"].includes(mark.mark)
    ) {
      throw new Error("A meeting mark lacks a unique mapped column or source evidence.");
    }
    seenMarks.add(mark.meetingId);
    slots.push({ columnIndex, value: mark.mark, evidenceId: mark.evidenceId });
  }
  return slots;
}

export type SemesterLedgerRow = {
  rowIndex: number;
  sourceKey: string;
  cells: ReadonlyArray<string | number | null>;
};

export type SemesterLedgerPlanInput = {
  destinationFileId: string;
  originalSourceFileId: string;
  acceptedDestinationFileId: string;
  acceptedOriginalSourceFileId: string;
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

// The caller must hold a reviewed source-row link and accepted destination mapping.
// It must re-read every expected cell before sending this plan to Google Sheets.
export function planSemesterLedgerRow(input: SemesterLedgerPlanInput): SemesterLedgerPlan {
  if (
    !input.destinationFileId ||
    !input.originalSourceFileId ||
    input.destinationFileId === input.originalSourceFileId ||
    input.acceptedDestinationFileId !== input.destinationFileId ||
    input.acceptedOriginalSourceFileId !== input.originalSourceFileId
  ) {
    throw new Error("Choose an accepted, separate Let's Assist destination workbook.");
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
