import { expect, test, type Locator } from "@playwright/test";
import {
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

async function expectUnobscuredFocus(control: Locator) {
  const state = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return {
      focused: document.activeElement === element,
      centerUnobscured: Boolean(hit && element.contains(hit)),
      inViewport:
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.top >= 0 &&
        box.bottom <= innerHeight,
    };
  });
  expect(state).toEqual({
    focused: true,
    centerUnobscured: true,
    inViewport: true,
  });
}

test("an untouched project stays pristine and a reverted edit clears the warning", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(
    page,
    "admin",
    "/projects/10000000-0000-4000-8000-000000000020/edit",
  );
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(
    page.getByText("No changes to save.", { exact: true }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  const title = page.getByRole("textbox", {
    name: "Project title",
    exact: true,
  });
  const original = await title.inputValue();
  await title.fill(`${original} revised`);
  await expect(
    page.getByText("You have unsaved changes.", { exact: true }),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await title.fill(original);
  await expect(
    page.getByText("No changes to save.", { exact: true }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  const attendeeVisibility = page.getByRole("switch", {
    name: "Show attendees publicly",
    exact: true,
  });
  await attendeeVisibility.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expectUnobscuredFocus(attendeeVisibility);
  expectNoBrowserFailures(failures);
});

test("the project timezone stays unobscured when reached by phone keyboard", async ({
  page,
}) => {
  const failures = watchBrowserFailures(page);
  await loginAs(page, "admin", "/projects/create");
  await expect(
    page.getByRole("heading", {
      name: "Create a volunteering project",
      exact: true,
    }),
  ).toBeVisible();
  const title = page.getByRole("textbox", {
    name: "Project title",
    exact: true,
  });
  const timezone = page.getByRole("combobox", {
    name: "Project timezone",
    exact: true,
  });
  await title.focus();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    if (
      await timezone.evaluate((element) => document.activeElement === element)
    )
      break;
  }
  await expect(timezone).toBeFocused();
  await expectUnobscuredFocus(timezone);
  expectNoBrowserFailures(failures);
});
