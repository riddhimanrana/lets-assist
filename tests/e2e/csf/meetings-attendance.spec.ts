import { expect, test, type Page } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const MEETINGS_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=meetings`;
const MEETING_LABEL = "Spring General Meeting";
const ROSTER_MEMBER_NAME = "Aarav Mehta";
const ROSTER_MEMBER_EMAIL = "aarav.mehta28@students.local.test";
const ROSTER_MEMBER_LABEL = `${ROSTER_MEMBER_NAME} · ${ROSTER_MEMBER_EMAIL}`;

const MENU_ACTIONS = [
  "Import attendance",
  "Advanced import",
  "Correct attendance",
  "Edit meeting",
  "Delete meeting",
] as const;

function meetingRow(page: Page) {
  return page.getByRole("row").filter({ hasText: MEETING_LABEL });
}

async function openMeetingsWorkspace(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Meetings", exact: true }),
  ).toBeVisible();
  const semester = page.getByRole("combobox", { name: "Choose semester" });
  if ((await semester.textContent())?.includes("Fall 2026")) {
    await semester.click();
    await page.getByRole("option", { name: /Spring 2026/ }).click();
  }
  const row = meetingRow(page);
  await expect(row).toHaveCount(1);
  return row;
}

/** Opens the row's overflow menu; items render in a portal, so query the page. */
async function openMeetingActionsMenu(
  page: Page,
  row: ReturnType<typeof meetingRow>,
) {
  await row
    .getByRole("button", { name: `Actions for ${MEETING_LABEL}`, exact: true })
    .click();
  await expect(
    page.getByText("Meeting actions", { exact: true }),
  ).toBeVisible();
}

test.describe("meeting attendance role boundaries", () => {
  test("secretary, data management, and web master see exactly their meeting actions", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);

    await test.step("secretary holds scheduling, import, and correction controls", async () => {
      await loginAs(page, "secretary", MEETINGS_PATH);
      const row = await openMeetingsWorkspace(page);

      await expect(
        page.getByRole("button", { name: "Add meeting", exact: true }),
      ).toBeVisible();
      await openMeetingActionsMenu(page, row);
      for (const action of MENU_ACTIONS) {
        await expect(
          page.getByRole("button", { name: action, exact: true }),
          `Secretary should see ${action}`,
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");
    });

    await test.step("data management reconciles and corrects but cannot schedule", async () => {
      await page.context().clearCookies();
      await loginAs(page, "dataManagement", MEETINGS_PATH);
      const row = await openMeetingsWorkspace(page);

      await expect(
        page.getByRole("button", { name: "Add meeting", exact: true }),
      ).toHaveCount(0);
      await openMeetingActionsMenu(page, row);
      for (const action of [
        "Import attendance",
        "Advanced import",
        "Correct attendance",
      ] as const) {
        await expect(
          page.getByRole("button", { name: action, exact: true }),
          `Data Management should see ${action}`,
        ).toBeVisible();
      }
      for (const action of ["Edit meeting", "Delete meeting"] as const) {
        await expect(
          page.getByRole("button", { name: action, exact: true }),
        ).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
    });

    await test.step("web master is denied the meetings route with the canonical alert", async () => {
      await page.context().clearCookies();
      await loginAs(page, "webMaster");

      const deniedPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/meetings`;
      const deniedResponse = await page.goto(deniedPath, {
        waitUntil: "domcontentloaded",
      });

      expect(deniedResponse?.status()).toBe(200);
      await expect(page).toHaveURL(deniedPath);
      const denialAlert = page
        .getByRole("alert")
        .filter({ hasText: "This area is not part of your CSF role" });
      await expect(denialAlert).toHaveCount(1);
      await expect(
        denialAlert.getByText(
          "Ask a CSF administrator to update your officer permissions if you need access.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Meetings", exact: true }),
      ).toHaveCount(0);

      // Data minimization for this signed-in role: the denial page must not
      // carry the meeting data the route refused. The other steps in this
      // file prove these exact strings render for permitted roles, so the
      // absence checks cannot pass vacuously.
      const deniedBodyText = await page.locator("body").innerText();
      expect(deniedBodyText).not.toContain(MEETING_LABEL);
      expect(deniedBodyText).not.toContain(ROSTER_MEMBER_NAME);
      expect(deniedBodyText).not.toContain(ROSTER_MEMBER_EMAIL);
      // No member's personal email may leak; every roster fixture address
      // shares the student domain.
      expect(deniedBodyText).not.toContain("@students.local.test");
    });

    expectNoBrowserFailures(failures);
  });

  test("secretary correction roster stays search-bounded and absent from the cohort view", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "secretary", MEETINGS_PATH);
    const row = await openMeetingsWorkspace(page);

    await test.step("the Correct dialog offers only the placeholder before a search", async () => {
      await openMeetingActionsMenu(page, row);
      await page
        .getByRole("button", { name: "Correct attendance", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Correct attendance" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(
          "Enter at least two characters. Results are limited to this meeting's term.",
        ),
      ).toBeVisible();

      const memberSelect = dialog.getByRole("combobox", {
        name: "Member",
        exact: true,
      });
      await memberSelect.click();
      const closedRoster = page.getByRole("listbox").getByRole("option");
      await expect(closedRoster).toHaveCount(1);
      await expect(closedRoster).toHaveText("Choose a CSF member");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    });

    await test.step("searching surfaces exactly the matching member's label", async () => {
      const dialog = page.getByRole("dialog", { name: "Correct attendance" });
      await dialog
        .getByRole("searchbox", { name: "Search meeting members" })
        .fill("Aarav");
      await dialog.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        dialog.getByText("1 matching members.", { exact: true }),
      ).toBeVisible();

      await dialog
        .getByRole("combobox", { name: "Member", exact: true })
        .click();
      const searchedRoster = page.getByRole("listbox").getByRole("option");
      await expect(searchedRoster).toHaveCount(2);
      await expect(
        page.getByRole("listbox").getByRole("option", {
          name: ROSTER_MEMBER_LABEL,
          exact: true,
        }),
      ).toBeVisible();

      // Close the option list, then the dialog, saving nothing.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    await test.step("class workspaces do not duplicate the officer meetings console", async () => {
      await page.getByRole("tab", { name: "Classes", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=csf-cohorts(?:&|$)/);
      await page
        .getByRole("link", { name: "Class of 2028", exact: true })
        .click();
      await expect(page).toHaveURL(/[?&]csf_cohort=/);
      const classTabs = page.getByRole("navigation", {
        name: "Class workspace tabs",
      });
      await expect(
        classTabs.getByRole("button", { name: "Meetings", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: `Actions for ${MEETING_LABEL}`,
          exact: true,
        }),
      ).toHaveCount(0);
      for (const action of [
        "Correct attendance",
        "Import attendance",
      ] as const) {
        await expect(
          page.getByRole("button", { name: action, exact: true }),
        ).toHaveCount(0);
      }
      await expect(
        page.getByRole("heading", { name: /Attendance review/ }),
      ).toHaveCount(0);
    });

    expectNoBrowserFailures(failures);
  });

  test("secretary inspects the advanced import and delete dialogs without submitting", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "secretary", MEETINGS_PATH);
    const row = await openMeetingsWorkspace(page);

    await test.step("the advanced import dialog carries the manual coordinates", async () => {
      await openMeetingActionsMenu(page, row);
      await page
        .getByRole("button", { name: "Advanced import", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Advanced import" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("textbox", { name: "Sheet tab", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("textbox", { name: "A1 range", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("spinbutton", {
          name: "Header row in range",
          exact: true,
        }),
      ).toBeVisible();
      const submit = dialog.getByRole("button", {
        name: "Preview rows",
        exact: true,
      });
      await expect(submit).toBeVisible();
      await expect(submit).toBeEnabled();

      // Deliberate boundary: this scenario only inspects the preview form and
      // dismisses it without submitting, so no import is ever requested. Any
      // Drive read would happen server-side and is not observable from the
      // browser, so this test makes no provider-traffic claim.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    await test.step("delete confirms before archiving and is dismissed without submitting", async () => {
      await openMeetingActionsMenu(page, row);
      await page
        .getByRole("button", { name: "Delete meeting", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: `Delete ${MEETING_LABEL}?`,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(
          "Attendance already recorded stays in member histories.",
          {
            exact: false,
          },
        ),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(meetingRow(page)).toHaveCount(1);
    });

    await test.step("the add-meeting form collects every date the meeting happens", async () => {
      await page
        .getByRole("button", { name: "Add meeting", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Add Meeting" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Add another date", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    expectNoBrowserFailures(failures);
  });
});
