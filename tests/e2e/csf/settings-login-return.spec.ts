import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localActors,
  localTestPassword,
  watchBrowserFailures,
} from "./helpers";

test("signed-out chapter settings returns to settings after administrator login", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  const settingsPath = `${CSF_ORGANIZATION_PATH}/settings`;
  await page.goto(settingsPath);
  await page.waitForURL((url) => url.pathname === "/login");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(settingsPath);

  const main = page.getByRole("main");
  await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
  await expect(
    main.getByText("Secure check ready", { exact: true }),
  ).toBeVisible();
  const signupHref = await main
    .getByRole("link", { name: "Sign up", exact: true })
    .getAttribute("href");
  expect(new URL(signupHref!, page.url()).searchParams.get("redirect")).toBe(
    settingsPath,
  );
  await main
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(localActors.admin.email);
  await main.getByLabel("Password").fill(localTestPassword());
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL((url) => url.pathname === settingsPath);
  await expect(
    page.getByRole("heading", { name: "Organization Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page Not Found", exact: true }),
  ).toHaveCount(0);
  expectNoBrowserFailures(failures);
});
