import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

import captureTemplate from "../../../scripts/local-dev/layout-audit/upstream/manifest.baseline-template.json" with { type: "json" };
import { readAxeRows } from "../../../scripts/local-dev/layout-audit/axe-color-diagnostics.mjs";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

async function expectPublicPageSemantics(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: axeSource });
  const rows = (await page.evaluate(readAxeRows, {
    includeColorDetails: true,
  })) as { id: string }[];
  expect(
    rows.filter((row) =>
      ["page-has-heading-one", "heading-order", "color-contrast"].includes(
        row.id,
      ),
    ),
  ).toEqual([]);
}

test("signed-out Help satisfies its frozen capture landmarks", async ({
  page,
}) => {
  const scene = captureTemplate.captures.find((entry) => entry.id === "help");
  if (!scene) throw new Error("Reviewed Help capture scene is missing");

  const response = await page.goto(scene.route, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/help$/);

  for (const landmark of scene.ready) {
    if (!("role" in landmark) || !("name" in landmark)) {
      throw new Error("Help requires a named semantic landmark");
    }
    await expect(
      page.getByRole(landmark.role as Parameters<Page["getByRole"]>[0], {
        name: landmark.name,
        exact: true,
      }),
    ).toBeVisible();
  }

  const search = page.getByRole("searchbox", {
    name: "Search help articles",
    exact: true,
  });
  await expect(search).toHaveAttribute("type", "search");
  await expect(
    page.getByRole("textbox", {
      name: "Search help articles",
      exact: true,
    }),
  ).toHaveCount(0);

  await search.fill("chapter setup");
  await expect(
    page.getByRole("option", { name: /CSF chapter setup/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Help center", exact: true }),
  ).toBeVisible();
  await expectPublicPageSemantics(page);
});

for (const { route, title } of [
  { route: "/signup", title: "Create an account" },
  {
    route: "/signup/success?email=platform.member%40local.test",
    title: "Account Created Successfully!",
  },
  { route: "/signup/success", title: "Invalid Access" },
  {
    route: "/auth/email-expired",
    title: "Verification link no longer works",
  },
]) {
  test(`signed-out ${route} exposes its page title as the sole h1`, async ({
    page,
  }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expectPublicPageSemantics(page);
  });
}

test("FAQ question headings follow the page title without skipping a level", async ({
  page,
}) => {
  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Frequently asked questions",
      exact: true,
    }),
  ).toBeVisible();
  const question = page.getByRole("heading", {
    level: 2,
    name: "What is Let’s Assist?",
    exact: true,
  });
  await expect(question).toBeVisible();
  const trigger = question.getByRole("button", {
    name: "What is Let’s Assist?",
    exact: true,
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expectPublicPageSemantics(page);
});
