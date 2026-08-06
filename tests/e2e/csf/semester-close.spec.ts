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

    await expect(
      page.getByText("Semester close preflight", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("8 unresolved", { exact: true })).toBeVisible();

    const expectedGroups = [
      { label: "Applications", count: "4", route: "csf-applications" },
      {
        label: "Point submissions",
        count: "2",
        route: "csf-activities&csf_service=points",
      },
      {
        label: "Point appeals",
        count: "0",
        route: "csf-activities&csf_service=points",
      },
      {
        label: "Attendance",
        count: "0",
        route: "csf-activities&csf_service=meetings",
      },
      { label: "Dues", count: "0", route: "csf-applications" },
      { label: "Imports", count: "2", route: "csf-imports" },
    ] as const;

    for (const group of expectedGroups) {
      const link = page.getByRole("link", {
        name: new RegExp(`^${group.label}\\b`),
      });
      await expect(link).toBeVisible();
      await expect(link).toContainText(group.count);
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`tab=${group.route}(?:&|#|$)`),
      );
    }

    await expect(
      page.getByRole("button", { name: "Close term" }),
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
