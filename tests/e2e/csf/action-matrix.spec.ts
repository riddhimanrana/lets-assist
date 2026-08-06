import { expect, test } from "@playwright/test";

import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

const primaryTabs = [
  "Home",
  "Applications",
  "Members",
  "Service",
  "Semester",
] as const;
const utilityTabs = [
  "Imports",
  "Reports",
  "Staff access",
  "Change history",
  "Settings",
] as const;

test.describe("admin visible-action matrix", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("primary navigation exposes canonical enabled actions", async ({
    page,
  }) => {
    for (const label of primaryTabs) {
      const action = page.getByRole("tab", { name: label, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toBeEnabled();
    }

    const applications = page.getByRole("tab", {
      name: "Applications",
      exact: true,
    });
    await applications.click();
    await expect(page).toHaveURL(/[?&]tab=csf-applications(?:&|$)/, {
      timeout: 60_000,
    });
  });

  test("More exposes each canonical utility and opens Settings", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    for (const label of utilityTabs) {
      const action = page.getByRole("menuitem", { name: label, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toBeEnabled();
    }

    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=csf-settings(?:&|$)/);
  });

  test("application list exposes enabled operational controls", async ({
    page,
  }) => {
    await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-applications`);
    const controls = page.locator(
      '[aria-label="Application views"] button:visible, [aria-label="Application filters"] button:visible, form[role="search"] button:visible, button[aria-label^="Sort applications"]:visible',
    );
    expect(await controls.count()).toBeGreaterThanOrEqual(8);
    for (const control of await controls.all()) {
      await expect(control).toBeVisible();
      await expect(control).toBeEnabled();
    }
  });
});
