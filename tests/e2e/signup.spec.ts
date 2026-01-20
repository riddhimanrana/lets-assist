import { expect, test } from "@playwright/test";

test("user can complete signup flow in E2E mode", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByText(/create an account/i)).toBeVisible();

  await page.getByRole("textbox", { name: /full name/i }).first().fill("E2E Test User");
  await page.getByRole("textbox", { name: /^email$/i }).first().fill(`e2e+${Date.now()}@example.com`);
  await page.getByLabel(/password/i).first().fill("Str0ngPass!123");

  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/signup\/success/i);
  await expect(page.getByText(/account created successfully/i)).toBeVisible();
});
