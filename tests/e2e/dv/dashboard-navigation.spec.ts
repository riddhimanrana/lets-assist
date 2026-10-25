import { expect, test } from "@playwright/test";
import { login } from "./membership-helpers";

test("phone navigation keeps every DV tab reachable without widening the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "dv.staff@local.test");
  const navigation = page.locator('[data-slot="dv-navigation-scroll"]');
  const tabs = navigation.getByRole("tab");
  await expect(tabs).toHaveCount(8);
  await expect
    .poll(() =>
      navigation.evaluate((element) => ({
        bounded: element.getBoundingClientRect().right <= window.innerWidth,
        scrollable: element.scrollWidth > element.clientWidth,
      })),
    )
    .toEqual({ bounded: true, scrollable: true });

  const settings = tabs.getByText("Settings", { exact: true });
  await settings.click();
  await expect(
    navigation.getByRole("tab", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => navigation.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  await navigation
    .getByRole("tab", { name: "Settings", exact: true })
    .press("Home");
  await expect(
    navigation.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeFocused();
});
