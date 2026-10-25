import { expect, test } from "@playwright/test";
import { PAGE_CONTENT_ID } from "@/components/layout/content-targets";
import {
  expectNoBrowserFailures,
  loginWithEmail,
  watchBrowserFailures,
} from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

test("plugin console focus keeps the page bounded and scrolls only the tab strip", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginWithEmail(page, "platform.admin@local.test", "/admin/plugins");
  const heading = page.getByRole("heading", { name: "Plugins", exact: true });
  await expect(heading).toBeVisible();
  const edit = page.getByRole("button", { name: "Edit details", exact: true });
  await edit.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(edit).toBeFocused();
  const headingBox = await heading.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.x).toBeGreaterThanOrEqual(0);
  expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(375);

  const advanced = page.getByRole("tab", { name: "Advanced", exact: true });
  await advanced.focus();
  await expect(advanced).toBeFocused();
  const geometry = await page.getByRole("tablist").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      clientWidth: element.clientWidth,
      contentWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.contentWidth).toBeGreaterThan(geometry.clientWidth);
  expect(geometry.scrollLeft).toBeGreaterThan(0);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(
    await page
      .locator(`#${PAGE_CONTENT_ID}`)
      .evaluate((element) => element.scrollLeft),
  ).toBe(0);
  expectNoBrowserFailures(failures);
});
