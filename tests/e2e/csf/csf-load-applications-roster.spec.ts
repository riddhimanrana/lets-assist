import { expect, test } from "@playwright/test";
import {
  applicationsRosterSearch,
  applicationsRosterSubjects,
  loadedReviewRecord,
  waitForLoadedReviewRecord,
} from "../../../scripts/hosted-development/csf-load-applications-roster.mjs";

test("hosted review acceptance waits for a loaded record and never accepts a loading panel", async ({
  page,
}) => {
  await page.setContent(`
    <div id="queue" aria-busy="false">
      <div><button aria-label="Next subject"></button></div>
      <div id="panel"><div role="status">Loading application…</div></div>
    </div>
  `);
  const queue = page.locator("#queue");
  const setRecord = (id: string | null) =>
    page.evaluate((value) => {
      const panel = document.getElementById("panel")!;
      if (value === null) panel.removeAttribute("data-review-record");
      else panel.setAttribute("data-review-record", value);
    }, id);

  // A panel with text but no record marker is a placeholder, not a subject.
  await expect(loadedReviewRecord(queue)).toHaveCount(0);
  await expect(waitForLoadedReviewRecord(queue, null, 300)).rejects.toThrow(
    "did not show a loaded record",
  );

  // The record arrives after the wait has started, the way a lazy read does.
  const first = waitForLoadedReviewRecord(queue, null, 5_000);
  await setRecord("record-a");
  expect(await first).toBe("record-a");

  // After a move, the record that was already on screen is not the answer.
  await expect(
    waitForLoadedReviewRecord(queue, "record-a", 300),
  ).rejects.toThrow("did not show a loaded record");
  const moved = waitForLoadedReviewRecord(queue, "record-a", 5_000);
  await setRecord(null);
  await setRecord("record-b");
  expect(await moved).toBe("record-b");
});

test("hosted review search selects the visible Applications panel with another roster mounted", async ({
  page,
}) => {
  await page.setContent(`
    <div data-slot="tabs-content" hidden>
      <div id="applications">
        <div class="flex flex-col gap-4"><div class="flex flex-wrap"><div class="relative"><input placeholder="Search by name"></div></div><ul><li><button>Member roster</button></li></ul></div>
      </div>
    </div>
    <div data-slot="tabs-content">
      <div id="applications">
        <div class="flex flex-col gap-4"><div class="flex flex-wrap"><div class="relative"><input placeholder="Search by name"></div></div><ul><li><button>Application roster</button></li></ul></div>
      </div>
    </div>
  `);

  await expect(page.getByPlaceholder("Search by name")).toHaveCount(2);
  const search = applicationsRosterSearch(page);
  await expect(search).toHaveCount(1);
  await expect(search).toBeVisible();
  await expect(applicationsRosterSubjects(search)).toHaveText(
    "Application roster",
  );
});
