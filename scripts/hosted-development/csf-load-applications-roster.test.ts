import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { applicationsRosterSearch } from "./csf-load-applications-roster.mjs";

test("hosted review search selects the visible Applications panel with another roster mounted", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
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

    expect(await page.getByPlaceholder("Search by name").count()).toBe(2);
    const search = applicationsRosterSearch(page);
    expect(await search.count()).toBe(1);
    await search.waitFor({ state: "visible" });
    expect(
      await search
        .locator(
          "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' space-y-4 ')][1]",
        )
        .locator("ul > li button")
        .textContent(),
    ).toBe("Application roster");
  } finally {
    await browser.close();
  }
});
