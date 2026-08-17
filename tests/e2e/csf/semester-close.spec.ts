import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

// The legacy semester-workspace deep link: it must alias onto the Terms page
// and, because it names the old policy view, open Chapter rules.
const legacyPolicyPath =
  `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts` + "&csf_semester_view=policy";

test.describe("transactional semester-close preflight", () => {
  test("shows every blocking domain inside the archive dialog and prevents a stale early close", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", legacyPolicyPath);

    // The legacy URL lands on the Terms page with Chapter rules expanded.
    await expect(
      page.getByRole("button", { name: "Start next term" }),
    ).toBeVisible();
    await expect(
      page.getByText("Chapter rules", { exact: true }),
    ).toBeVisible();

    // The preflight lives inside the archive flow now: the trigger stays
    // available, and opening it presents the server-derived blocker list.
    const archiveTrigger = page.getByRole("button", { name: "Archive term" });
    await expect(archiveTrigger).toBeEnabled();
    await archiveTrigger.click();

    const dialog = page.getByRole("dialog", { name: "Close a CSF term" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Semester close preflight", { exact: true }),
    ).toBeVisible();

    // Counts marked with a number are invariant across the suite. Imports is
    // not: earlier full-suite import journeys intentionally leave immutable
    // reconciliation evidence behind, so we only require that it still has
    // unresolved work and reconcile the header total against the rendered sum.
    const expectedGroups = [
      { label: "Applications", count: 4, route: "csf-applications" },
      {
        label: "Point submissions",
        count: 2,
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
      { label: "Dues", count: 0, route: "csf-applications" },
      { label: "Imports", count: null, route: "csf-imports" },
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
        expect(renderedCount).toBeGreaterThan(0);
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
