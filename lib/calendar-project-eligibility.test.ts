import { expect, test } from "bun:test";
import { canSyncCalendarProject } from "./calendar-project-eligibility";

test("calendar controls exclude cancelled and unpublished projects", () => {
  expect(
    canSyncCalendarProject({
      status: "cancelled",
      workflow_status: "published",
    }),
  ).toBe(false);
  expect(
    canSyncCalendarProject({ status: "upcoming", workflow_status: "draft" }),
  ).toBe(false);
  expect(
    canSyncCalendarProject({
      status: "completed",
      workflow_status: "published",
    }),
  ).toBe(true);
  expect(
    canSyncCalendarProject({ status: "upcoming", workflow_status: null }),
  ).toBe(true);
});
