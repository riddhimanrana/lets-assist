import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const policyPath =
  `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts` + "&csf_semester_view=policy";

test.describe("transactional semester-close preflight", () => {
  test("shows every blocking domain and prevents a stale early close", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", policyPath);

    // A semester deep link lands with "Semesters & setup" already open, so
    // the preflight is visible without hunting for the disclosure.
    await expect(
      page.getByText("Semester close preflight", { exact: true }),
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
      const link = page.getByRole("link", {
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
      page.getByText(`${totalUnresolved} unresolved`, { exact: true }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Archive term" }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Resolve every linked record before the close action becomes available.",
        { exact: true },
      ),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });
});
