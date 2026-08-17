import { expect, test } from "@playwright/test";

import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

const primaryTabs = ["Home", "Classes", "Applications"] as const;
const utilityTabs = [
  "Meetings",
  "Partner clubs",
  "Import history",
  "Reports",
  "Officers & access",
  "Change history",
  "Communications",
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

  test("applications tab mounts the review campaign workspace", async ({
    page,
  }) => {
    await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-applications`);
    // The tab is the application review campaign: the shared review chrome
    // renders and the old queue-chip toolbar is gone.
    await expect(page.locator("#applications")).toBeVisible();
    await expect(
      page.locator('[aria-label="Application work queues"]'),
    ).toHaveCount(0);
  });
});
