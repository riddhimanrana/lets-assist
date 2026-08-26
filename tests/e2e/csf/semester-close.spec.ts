import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const chapterRulesPath =
  `${CSF_ORGANIZATION_PATH}?tab=csf-terms` + "&csf_rules=open";

test.describe("transactional semester-close preflight", () => {
  test("shows every blocking domain inside the close dialog and prevents a stale early close", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", chapterRulesPath);

    // The canonical Terms URL opens Chapter rules explicitly.
    await expect(
      page.getByRole("button", { name: "Start next term" }),
    ).toBeVisible();
    await expect(
      page.getByText("Chapter rules", { exact: true }),
    ).toBeVisible();

    // The preflight lives inside the close flow: the trigger stays
    // available, and opening it presents the server-derived blocker list.
    const archiveTrigger = page.getByRole("button", { name: "Close term" });
    await expect(archiveTrigger).toBeEnabled();
    await archiveTrigger.click();

    const dialog = page.getByRole("dialog", { name: "Close this semester" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Semester close preflight", { exact: true }),
    ).toBeVisible();

    // The current synthetic term has one active member with unresolved dues;
    // historical Spring work must not leak into this Fall preflight.
    const expectedGroups = [
      { label: "Applications", count: 0, route: "csf-applications" },
      {
        label: "Point submissions",
        count: 0,
        route: "csf-activities&csf_service=points",
      },
      {
        label: "Point appeals",
        count: 0,
        route: "csf-activities&csf_service=points",
      },
      {
        label: "Attendance",
        count: 0,
        route: "csf-activities&csf_service=meetings",
      },
      { label: "Dues", count: 1, route: "csf-applications" },
      { label: "Imports", count: null, route: "csf-cohorts" },
    ] as const;

    let totalUnresolved = 0;
    for (const group of expectedGroups) {
      const link = dialog.getByRole("link", {
        name: new RegExp(`^${group.label}\\b`),
      });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`tab=${group.route}(?:&|#|$)`),
      );

      const badgeText = (
        await link.locator('[data-slot="badge"]').innerText()
      ).trim();
      expect(badgeText).toMatch(/^\d+$/);
      const renderedCount = Number.parseInt(badgeText, 10);
      expect(renderedCount).toBeGreaterThanOrEqual(0);
      if (group.count === null) {
        // Other full-suite import journeys may leave immutable reconciliation
        // evidence, but the retired Import history route must stay gone.
        expect(renderedCount).toBeGreaterThanOrEqual(0);
      } else {
        expect(renderedCount).toBe(group.count);
      }
      totalUnresolved += renderedCount;
    }

    await expect(
      dialog.getByText(`${totalUnresolved} unresolved`, { exact: true }),
    ).toBeVisible();

    // Blockers remain, so the destructive submit stays locked while the
    // refusal names the condition.
    await expect(
      dialog.getByRole("button", { name: "Close and snapshot term" }),
    ).toBeDisabled();
    await expect(
      dialog.getByText(
        "Resolve every linked record before the close action becomes available.",
        { exact: true },
      ),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });
});
