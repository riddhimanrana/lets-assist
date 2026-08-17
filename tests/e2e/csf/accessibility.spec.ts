import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoCriticalAxeViolations } from "./axe";
import {
  CSF_ORGANIZATION_PATH,
  CSF_PUBLIC_PATH,
  expectNoBrowserFailures,
  loginAs,
  soleAccessibleAction,
  watchBrowserFailures,
} from "./helpers";

const SUBMISSIONS_TAB_URL = `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`;
const STAFF_TAB_URL = `${CSF_ORGANIZATION_PATH}?tab=csf-staff`;

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const colorSchemes = ["light", "dark"] as const;

/**
 * The workspace chrome is responsive: below Tailwind's `sm` breakpoint
 * (640px) the tab strip is replaced by the single section switcher, and the
 * hidden variant of the other marker stays in the DOM. Readiness therefore
 * keys off the active viewport width and waits for the marker that must be
 * visible there before an axe scan.
 */
async function awaitWorkspaceChrome(
  page: Page,
  defaultTab: string,
  viewportWidth: number,
) {
  if (viewportWidth < 640) {
    await expect(
      page.getByTestId("organization-section-switcher"),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("tab", { name: defaultTab, exact: true }),
    ).toBeVisible();
  }
}

async function pressTabUntil(page: Page, target: Locator, description: string) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`${description} was not reached within 12 Tab presses`);
}

test.describe("DVHS CSF accessibility acceptance", () => {
  for (const viewport of viewports) {
    test(`anonymous surfaces pass the critical axe gate on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      test.slow();
      const failures = watchBrowserFailures(page);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      for (const colorScheme of colorSchemes) {
        await page.emulateMedia({ colorScheme });

        await page.goto("/login");
        await expect(
          page.getByRole("main").locator('form[data-hydrated="true"]'),
        ).toBeVisible();
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `login-${viewport.name}-${colorScheme}`,
        );

        await page.goto(CSF_PUBLIC_PATH);
        await expect(
          page.getByRole("heading", {
            name: /DVHS CSF|Dougherty Valley High School CSF/,
          }),
        ).toBeVisible();
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `csf-public-${viewport.name}-${colorScheme}`,
        );
      }

      expectNoBrowserFailures(failures);
    });

    test(`member surfaces pass the critical axe gate on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      test.slow();
      const failures = watchBrowserFailures(page);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await loginAs(page, "member");

      for (const colorScheme of colorSchemes) {
        await page.emulateMedia({ colorScheme });

        await page.goto(CSF_ORGANIZATION_PATH, {
          waitUntil: "domcontentloaded",
        });
        await awaitWorkspaceChrome(page, "Feed", viewport.width);
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `member-feed-${viewport.name}-${colorScheme}`,
        );

        await page.goto(SUBMISSIONS_TAB_URL, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Submit points", exact: true }),
        ).toBeVisible();
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `member-submissions-${viewport.name}-${colorScheme}`,
        );
      }

      expectNoBrowserFailures(failures);
    });

    test(`admin surfaces pass the critical axe gate on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      test.slow();
      const failures = watchBrowserFailures(page);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await loginAs(page, "admin");

      for (const colorScheme of colorSchemes) {
        await page.emulateMedia({ colorScheme });

        await page.goto(CSF_ORGANIZATION_PATH, {
          waitUntil: "domcontentloaded",
        });
        await awaitWorkspaceChrome(page, "Home", viewport.width);
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `admin-home-${viewport.name}-${colorScheme}`,
        );

        await page.goto(STAFF_TAB_URL, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("heading", { name: "Officer roster", exact: true }),
        ).toBeVisible();
        await expectNoCriticalAxeViolations(
          page,
          testInfo,
          `admin-staff-${viewport.name}-${colorScheme}`,
        );
      }

      expectNoBrowserFailures(failures);
    });
  }

  test("the login form is reachable and ordered for keyboard-only use", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.goto("/login");
    const main = page.getByRole("main");
    await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
    await expect(
      main.getByText("Secure check ready", { exact: true }),
    ).toBeVisible();

    const email = main.getByRole("textbox", { name: "Email" });
    const password = main.getByLabel("Password");
    const login = main.getByRole("button", { name: "Login", exact: true });

    // Forward traversal reaches every control of the real form in reading
    // order: Email, then Password, then the Login action.
    await pressTabUntil(page, email, "the Email field");
    await expect(email).toBeFocused();
    await pressTabUntil(page, password, "the Password field");
    await expect(password).toBeFocused();
    await pressTabUntil(page, login, "the Login button");
    await expect(login).toBeFocused();

    // Reverse traversal returns along the same order.
    await page.keyboard.press("Shift+Tab");
    await expect(password).toBeFocused();

    expectNoBrowserFailures(failures);
  });

  test("keyboard activation opens the submission dialog and restores focus", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member", SUBMISSIONS_TAB_URL);

    const submit = await soleAccessibleAction(page, "Submit points");
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const focusInsideDialog = () =>
      dialog.evaluate((element) => element.contains(document.activeElement));
    await expect.poll(focusInsideDialog).toBe(true);

    // Tabbing never escapes the open dialog.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDialog()).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(submit).toBeFocused();

    expectNoBrowserFailures(failures);
  });

  test("the submission dialog and its selection live region expose exact semantics", async ({
    page,
  }, testInfo) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "member", SUBMISSIONS_TAB_URL);

    await (await soleAccessibleAction(page, "Submit points")).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("One proof file").setInputFiles({
      name: "service-proof.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(2048, 7),
    });
    const selection = dialog.locator("#csf-submission-evidence-selection");
    await expect(selection).toContainText("service-proof.png");

    // The dialog is labelled by its title, the proof controls live in the
    // named "Proof" fieldset group, and the accepted file is announced
    // through the status live region inside that group. An aria snapshot
    // would have to describe the dialog's full subtree, so the semantics
    // are pinned with targeted accessible-role assertions instead.
    await expect(dialog).toHaveAccessibleName("Submit service points");
    await expect(
      dialog.getByRole("heading", {
        name: "Submit service points",
        level: 2,
        exact: true,
      }),
    ).toBeVisible();
    const proof = dialog.getByRole("group", { name: "Proof" });
    await expect(proof).toBeVisible();
    await expect(
      proof.getByRole("button", { name: "One proof file" }),
    ).toBeVisible();
    await expect(proof.getByRole("status")).toHaveText(
      /Selected service-proof\.png/,
    );

    // The open dialog itself passes the same critical axe gate.
    await expectNoCriticalAxeViolations(page, testInfo, "member-submit-dialog");

    expectNoBrowserFailures(failures);
  });

  test("desktop and phone navigation expose the expected accessible tree", async ({
    page,
  }) => {
    test.slow();
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "admin");

    const tablist = page
      .getByRole("tablist")
      .filter({ has: page.getByRole("tab", { name: "Home", exact: true }) });
    await expect(tablist).toMatchAriaSnapshot(`
      - tablist:
        - tab "Home" [selected]
        - tab "Classes"
        - tab "Applications"
    `);

    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menu")).toMatchAriaSnapshot(`
      - menu "More":
        - group "More":
          - menuitem "Meetings"
          - menuitem "Partner clubs"
          - menuitem "Import history"
          - menuitem "Reports"
          - menuitem "Officers & access"
          - menuitem "Change history"
          - menuitem "Communications"
          - menuitem "Settings"
          - menuitem "Help"
    `);
    await page.keyboard.press("Escape");

    // The phone chrome replaces the strip with one grouped section switcher.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CSF_ORGANIZATION_PATH, { waitUntil: "domcontentloaded" });
    const switcher = page.getByTestId("organization-section-switcher");
    await expect(switcher).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);

    await switcher.click();
    await expect(page.getByRole("menu")).toMatchAriaSnapshot(`
      - menu:
        - group "Workspace":
          - menuitem "Home"
          - menuitem "Classes"
          - menuitem "Applications"
        - group "More":
          - menuitem "Meetings"
          - menuitem "Partner clubs"
          - menuitem "Import history"
          - menuitem "Reports"
          - menuitem "Officers & access"
          - menuitem "Change history"
          - menuitem "Communications"
          - menuitem "Settings"
          - menuitem "Help"
    `);
    await page.keyboard.press("Escape");

    expectNoBrowserFailures(failures);
  });

  test("reduced motion disables the landing reveal animation in the browser", async ({
    page,
  }) => {
    // Non-vacuous baseline first: with full motion the reveal items really
    // animate, so the reduced-motion assertion cannot pass by absence.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const items = page.locator(".la-text-reveal-item");
    await expect(items.first()).toBeAttached();
    const animatedDuration = await items
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(animatedDuration).not.toBe("0s");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(items.first()).toBeAttached();
    const reduced = await items.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        transitionDuration: style.transitionDuration,
        opacity: style.opacity,
        transform: style.transform,
      };
    });
    // The stylesheet's reduced-motion branch removes the transition and shows
    // the text immediately, without movement. The `data-visible` rule still
    // applies an explicit no-op transform, so the computed value may be the
    // identity matrix rather than "none".
    expect(reduced.transitionDuration).toBe("0s");
    expect(reduced.opacity).toBe("1");
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(reduced.transform);
  });
});
