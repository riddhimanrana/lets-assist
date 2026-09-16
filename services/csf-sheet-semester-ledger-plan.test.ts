import { describe, expect, test } from "bun:test";

import {
  planSemesterLedgerRow,
  projectSemesterLedgerSlots,
  type SemesterLedgerPlanInput,
} from "./csf-sheet-semester-ledger-plan";

const base: SemesterLedgerPlanInput = {
  destinationFileId: "separate-lets-assist-workbook",
  originalSourceFileId: "original-class-workbook",
  destinationCopiedFromFileId: "original-class-workbook",
  profileId: "profile-1",
  reviewedLinkProfileId: "profile-1",
  reviewedLinkSourceKey: "reviewed-row-key",
  reviewedLinkSourceFileId: "original-class-workbook",
  destinationRows: [
    { rowIndex: 5, sourceKey: "reviewed-row-key", cells: ["", "", "", "", ""] },
  ],
  slots: [
    { columnIndex: 2, value: "Service activity", evidenceId: "credit-1" },
    { columnIndex: 4, value: "X", evidenceId: "attendance-1" },
  ],
  firstWritableColumn: 2,
  lastWritableColumn: 4,
};

describe("semester ledger planning", () => {
  test("repeats evidenced activity names by point and uses only explicit meeting marks", () => {
    expect(projectSemesterLedgerSlots({
      activityColumns: [2, 3, 4],
      meetingColumns: [{ meetingId: "september", columnIndex: 5 }, { meetingId: "october", columnIndex: 6 }],
      activities: [{ title: "Community service", points: 2, evidenceId: "credit-1" }],
      meetingMarks: [{ meetingId: "september", mark: "X", evidenceId: "attendance-1" }],
    })).toEqual([
      { columnIndex: 2, value: "Community service", evidenceId: "credit-1" },
      { columnIndex: 3, value: "Community service", evidenceId: "credit-1" },
      { columnIndex: 5, value: "X", evidenceId: "attendance-1" },
    ]);
  });

  test("holds overflow and unevidenced marks for officer review", () => {
    expect(() => projectSemesterLedgerSlots({
      activityColumns: [2], meetingColumns: [],
      activities: [{ title: "Community service", points: 2, evidenceId: "credit-1" }], meetingMarks: [],
    })).toThrow();
    expect(() => projectSemesterLedgerSlots({
      activityColumns: [], meetingColumns: [{ meetingId: "september", columnIndex: 5 }],
      activities: [], meetingMarks: [{ meetingId: "september", mark: "X", evidenceId: "" }],
    })).toThrow();
  });

  test("writes only reviewed, evidenced cells and is repeat-safe", () => {
    const first = planSemesterLedgerRow(base);
    expect(first).toEqual({
      rowIndex: 5,
      changes: [
        { rowIndex: 5, columnIndex: 2, expectedValue: "", value: "Service activity", evidenceId: "credit-1" },
        { rowIndex: 5, columnIndex: 4, expectedValue: "", value: "X", evidenceId: "attendance-1" },
      ],
    });
    expect(planSemesterLedgerRow({
      ...base,
      destinationRows: [{ rowIndex: 9, sourceKey: "reviewed-row-key", cells: ["", "", "Service activity", "", "X"] }],
    })).toEqual({ rowIndex: 9, changes: [] });
  });

  test("refuses an original workbook or unverified copy", () => {
    expect(() => planSemesterLedgerRow({ ...base, destinationFileId: base.originalSourceFileId })).toThrow();
    expect(() => planSemesterLedgerRow({ ...base, destinationCopiedFromFileId: "other-source" })).toThrow();
  });

  test("refuses unreviewed profiles, ambiguous rows, and existing historical values", () => {
    expect(() => planSemesterLedgerRow({ ...base, reviewedLinkProfileId: "different-profile" })).toThrow();
    expect(() => planSemesterLedgerRow({ ...base, destinationRows: [...base.destinationRows, ...base.destinationRows] })).toThrow();
    expect(() => planSemesterLedgerRow({
      ...base,
      destinationRows: [{ rowIndex: 5, sourceKey: "reviewed-row-key", cells: ["", "", "Older activity", "", ""] }],
    })).toThrow();
  });

  test("refuses a clipped or unevidenced column", () => {
    expect(() => planSemesterLedgerRow({
      ...base,
      slots: [...base.slots, { columnIndex: 5, value: "Extra activity", evidenceId: "credit-2" }],
    })).toThrow();
    expect(() => planSemesterLedgerRow({
      ...base,
      slots: [{ columnIndex: 2, value: "X", evidenceId: "" }],
    })).toThrow();
  });
});
