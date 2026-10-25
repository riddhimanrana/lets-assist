import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type HelperResult =
  | { success: true; message: string }
  | { success: false; error: string; code?: string; retryable?: boolean };
const updateCalendarEventForProject = mock(
  async (_projectId: string): Promise<HelperResult> => ({
    success: true,
    message: "Calendar event updated successfully",
  }),
);
mock.module("@/utils/calendar-helpers", () => ({
  updateCalendarEventForProject,
}));
const { EditProjectCalendarNotice, runProjectCalendarUpdate } =
  await import("./EditProjectCalendarNotice");
afterAll(() => mock.restore());
beforeEach(() => updateCalendarEventForProject.mockClear());

const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const render = (
  issue: Parameters<typeof EditProjectCalendarNotice>[0]["issue"],
  retrying = false,
) =>
  renderToStaticMarkup(
    <EditProjectCalendarNotice
      issue={issue}
      retrying={retrying}
      onRetry={async () => {}}
      onViewProject={() => {}}
    />,
  );

test("a confirmed update reports no issue", async () => {
  expect(await runProjectCalendarUpdate(PROJECT_ID, true)).toBeNull();
  expect(updateCalendarEventForProject).toHaveBeenCalledWith(PROJECT_ID);
});

test("a server refusal is surfaced with its own message instead of being ignored", async () => {
  updateCalendarEventForProject.mockImplementationOnce(async () => ({
    success: false,
    error: "Retry to apply the latest details.",
    retryable: true,
  }));
  expect(await runProjectCalendarUpdate(PROJECT_ID, true)).toEqual({
    message: "Retry to apply the latest details.",
    retryable: true,
  });

  updateCalendarEventForProject.mockImplementationOnce(async () => ({
    success: false,
    error: "Project schedule not found",
    retryable: false,
  }));
  expect(await runProjectCalendarUpdate(PROJECT_ID, true)).toEqual({
    message: "Project schedule not found",
    retryable: false,
  });
});

test("a thrown action is a retryable issue, never success", async () => {
  updateCalendarEventForProject.mockImplementationOnce(async () => {
    throw new Error("network unavailable");
  });
  expect(await runProjectCalendarUpdate(PROJECT_ID, true)).toMatchObject({
    retryable: true,
  });
});

test("another editor is told who owns the calendar entry, and only when one exists", async () => {
  const refusal = async (): Promise<HelperResult> => ({
    success: false,
    error: "Only the project creator can update their Google Calendar entry",
    code: "not_owner",
  });
  updateCalendarEventForProject.mockImplementationOnce(refusal);
  const issue = await runProjectCalendarUpdate(PROJECT_ID, true);
  expect(issue?.retryable).toBe(false);
  expect(issue?.message).toContain("Only the creator can refresh it");
  // Nothing was observed at Google, so the copy must not claim the entry is stale.
  expect(issue?.message).toContain("belongs to its creator");
  expect(issue?.message).not.toMatch(/still shows|earlier details|out of date/);

  updateCalendarEventForProject.mockImplementationOnce(refusal);
  expect(await runProjectCalendarUpdate(PROJECT_ID, false)).toBeNull();
});

test("the notice states the save succeeded, the calendar did not, and offers a retry and a way out", () => {
  const html = render({
    message: "Retry to apply the latest details.",
    retryable: true,
  });
  // A write can land without its acknowledgement, so the heading claims neither outcome.
  expect(html).toContain(
    "Project saved. Google Calendar update is unconfirmed.",
  );
  expect(html).not.toContain("was not updated");
  expect(html).toContain("Retry to apply the latest details.");
  expect(html).toContain("Retry calendar update");
  expect(html).toContain("View project");
  expect(html).not.toContain("updated successfully");
});

test("a non-retryable issue keeps the way out but offers no retry", () => {
  const html = render({ message: "Ask the creator.", retryable: false });
  expect(html).toContain("Ask the creator.");
  expect(html).not.toContain("Retry calendar update");
  expect(html).toContain("View project");
});

test("the retry is disabled while one is running, and no issue renders nothing", () => {
  const issue = { message: "Retry.", retryable: true };
  expect(render(issue, true)).toContain('disabled=""');
  expect(render(issue)).not.toContain('disabled=""');
  expect(render(null)).toBe("");
});
