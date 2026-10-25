import { expect, test } from "@playwright/test";
import {
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

test("keyboard focus scrolls the Hours roster without clipping its session heading", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(
    page,
    "admin",
    "/projects/10000000-0000-4000-8000-000000000020/hours",
  );
  await expect(
    page.getByRole("heading", { name: "Manage volunteer hours", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Times are shown in America\/Los_Angeles\./),
  ).toBeVisible();
  const edit = page
    .getByRole("button", { name: "Edit visits", exact: true })
    .first();
  const table = page
    .locator('[data-slot="table-container"]')
    .filter({ has: edit });
  await expect(table).toHaveCount(1);

  await edit.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(edit).toBeFocused();

  const geometry = await table.evaluate((element) => {
    const card = element.closest('[data-slot="card"]');
    const title = card?.querySelector('[data-slot="card-title"]');
    const tableBox = element.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    return {
      tableLeft: tableBox.left,
      tableRight: tableBox.right,
      tableWidth: element.clientWidth,
      contentWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      cardScrollLeft: card?.scrollLeft,
      titleLeft: titleBox?.left,
      titleRight: titleBox?.right,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.tableLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.tableRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.contentWidth).toBeGreaterThan(geometry.tableWidth);
  expect(geometry.scrollLeft).toBeGreaterThan(0);
  expect(geometry.cardScrollLeft).toBe(0);
  expect(geometry.titleLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.titleRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expectNoBrowserFailures(failures);
});
