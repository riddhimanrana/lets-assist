import { expect, test } from "@playwright/test";

import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

const filteredListPath =
  `${CSF_ORGANIZATION_PATH}?tab=csf-applications` +
  "&csf_application_view=all" +
  "&csf_application_q=Maya" +
  "&csf_application_sort=name";

test.describe("compact applications list and addressable review", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin", filteredListPath);
  });

  test("renders one compact shadcn-style list with complete operational filters", async ({
    page,
  }) => {
    await expect(page.getByRole("navigation", { name: "Application views" })).toBeVisible();
    await expect(page.getByRole("button", { name: /All applications/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue(
      "Maya",
    );

    for (const filter of ["Status", "Eligibility", "Dues", "Assignee", "Class", "Term"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${filter} filter`) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Sort applications: Student name" })).toBeVisible();

    const applicationLinks = page.locator('a[href*="csf_application="]');
    await expect(applicationLinks.first()).toBeVisible();
    expect(await applicationLinks.count()).toBeGreaterThan(0);

    const row = await applicationLinks.first().boundingBox();
    expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(row?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(64);
  });

  test("detail URL and browser Back preserve the list query, sort, and view", async ({ page }) => {
    const listUrl = page.url();
    const firstApplication = page.locator('a[href*="csf_application="]').first();
    const detailHref = await firstApplication.getAttribute("href");
    expect(detailHref).toContain("csf_application=");
    expect(detailHref).toContain("csf_application_view=all");
    expect(detailHref).toContain("csf_application_q=Maya");
    expect(detailHref).toContain("csf_application_sort=name");

    await firstApplication.click();
    await expect(page).toHaveURL(/csf_application=[0-9a-f-]+/);
    await expect(page.getByText("Application review", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to applications" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Courses and academic eligibility/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Source and supporting files/ })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue(
      "Maya",
    );

    await page.locator('a[href*="csf_application="]').first().click();
    await page.getByRole("button", { name: "Back to applications" }).click();
    await expect(page).toHaveURL(listUrl);
  });
});
