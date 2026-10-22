import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers";

test("signed-in Home fills its available width and retains responsive gutters", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 900 });
  await loginAs(page, "member", "/home");
  await expect(page).toHaveTitle(/^Home\b/);

  const header = page.locator('main [data-slot="page-header"]');
  await expect(header).toBeVisible();
  const content = header.locator("..");

  for (const width of [320, 390, 639, 640, 768, 1024, 1440, 2048]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(
        async () => {
          return content.evaluate((element) => {
            const parent = element.parentElement;
            if (!parent)
              throw new Error("Home content has no containing block");
            const rect = element.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            const style = getComputedStyle(element);
            const gutter = window.innerWidth < 640 ? 16 : 24;
            return (
              Math.abs(rect.width - parentRect.width) < 1 &&
              Math.abs(rect.left - parentRect.left) < 1 &&
              Number.parseFloat(style.paddingLeft) === gutter &&
              Number.parseFloat(style.paddingRight) === gutter &&
              document.documentElement.scrollWidth <= window.innerWidth + 1
            );
          });
        },
        { message: `Home width and gutters at ${width}px` },
      )
      .toBe(true);
    const headerBox = await header.boundingBox();
    const contentBox = await content.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    const gutter = width < 640 ? 16 : 24;
    expect(Math.abs(headerBox!.x - contentBox!.x - gutter)).toBeLessThan(1);
    expect(
      Math.abs(headerBox!.width - (contentBox!.width - gutter * 2)),
    ).toBeLessThan(1);
  }

  await expect(page).toHaveURL(/\/home(?:\?|$)/);
  expect(pageErrors).toEqual([]);
});
