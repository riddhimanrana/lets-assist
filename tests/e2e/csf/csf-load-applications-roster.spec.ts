import { expect, test } from "@playwright/test";
import { applicationsRosterSearch } from "../../../scripts/hosted-development/csf-load-applications-roster.mjs";

test("hosted review search selects the visible Applications panel with another roster mounted", async ({
  page,
}) => {
  await page.setContent(`
    <div data-slot="tabs-content" hidden>
      <div id="applications">
        <div class="space-y-4"><input placeholder="Search by name"><ul><li><button>Member roster</button></li></ul></div>
      </div>
    </div>
    <div data-slot="tabs-content">
      <div id="applications">
        <div class="space-y-4"><input placeholder="Search by name"><ul><li><button>Application roster</button></li></ul></div>
      </div>
    </div>
  `);

  await expect(page.getByPlaceholder("Search by name")).toHaveCount(2);
  const search = applicationsRosterSearch(page);
  await expect(search).toHaveCount(1);
  await expect(search).toBeVisible();
  await expect(
    search
      .locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' space-y-4 ')][1]",
      )
      .locator("ul > li button"),
  ).toHaveText("Application roster");
});
