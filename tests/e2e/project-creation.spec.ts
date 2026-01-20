import { expect, test } from "@playwright/test";

const futureDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date.toISOString().slice(0, 10);
};

test("trusted user can progress project creation wizard", async ({ page }) => {
  await page.goto("/projects/create");

  const mock = page.getByTestId("e2e-project-mock");
  await expect(mock).toBeVisible();

  await page.getByTestId("e2e-project-title").fill("E2E Beach Cleanup");
  await page.getByTestId("e2e-project-location").fill("123 Test Street");
  await page.getByTestId("e2e-project-date").fill(futureDate());

  await expect(page.getByTestId("e2e-project-confirm")).toContainText("Mock project ready");
});
