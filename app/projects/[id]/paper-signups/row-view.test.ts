import { expect, test } from "bun:test";
import { hasPersistedAttendance } from "@/lib/projects/paper-signup/review-state";
import { paperRowView, REVIEW_ROW_COLUMNS } from "./row-view";

test("saved attendance survives pending outcomes in server review data", () => {
  for (const stored of [
    { committed_signup_id: "signup" },
    { project_paper_roster_entries: [{ id: "roster" }] },
    { project_paper_roster_entries: { id: "roster" } },
  ]) {
    const row = paperRowView({ id: "row", outcome: "pending", ...stored });
    expect(row.savedAttendance).toBe(true);
    expect(hasPersistedAttendance(row)).toBe(true);
  }
  expect(REVIEW_ROW_COLUMNS).toContain("committed_signup_id");
  expect(REVIEW_ROW_COLUMNS).toContain("project_paper_roster_entries(id)");
});

test("an unsaved draft remains discardable without exposing roster IDs", () => {
  const row = paperRowView({
    id: "row",
    outcome: "pending",
    committed_signup_id: null,
    project_paper_roster_entries: [],
  });
  expect(row.savedAttendance).toBe(false);
  expect(hasPersistedAttendance(row)).toBe(false);
  expect(row).not.toHaveProperty("project_paper_roster_entries");
});

test("a combined source does not imply saved attendance in server review data", () => {
  const row = paperRowView({
    id: "source-row",
    outcome: "skipped",
    outcome_detail: "combined_into:target-row",
    committed_signup_id: null,
    project_paper_roster_entries: [],
  });
  expect(row.savedAttendance).toBe(false);
  expect(hasPersistedAttendance(row)).toBe(false);
});
