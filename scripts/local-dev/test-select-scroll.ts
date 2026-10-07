import { readFile } from "node:fs/promises";
import path from "node:path";

import { chromium, expect } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss, { type AcceptedPlugin } from "postcss";

const root = path.resolve(import.meta.dir, "../..");
const build = await Bun.build({
  entrypoints: [path.join(root, "tests/browser/select-scroll.fixture.tsx")],
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
if (!build.success)
  throw new AggregateError(build.logs, "Fixture build failed");
const cssPath = path.join(root, "app/globals.css");
// Tailwind bundles a separate PostCSS minor with incompatible recursive types.
// Its plugin still uses the same PostCSS 8 runtime interface.
const plugin = tailwindcss({ base: root }) as unknown as AcceptedPlugin;
const css = await postcss([plugin]).process(await readFile(cssPath, "utf8"), {
  from: cssPath,
});
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    for (const alignItemWithTrigger of [false, true]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(
        `<html data-align-trigger="${alignItemWithTrigger}"><body><div id="root"></div></body></html>`,
      );
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({
        content: await build.outputs[0].text(),
        type: "module",
      });
      const trigger = page.getByRole("combobox", { name: "Long menu" });
      await trigger.click();
      const down = page.locator('[data-slot="select-scroll-down-button"]');
      await expect(down).toBeVisible();
      await down.hover();
      const finalOption = page.getByRole("option", {
        name: "Option 24",
        exact: true,
      });
      await expect(finalOption).toBeInViewport();
      await finalOption.click();
      await expect(trigger.locator('[data-slot="select-value"]')).toHaveText(
        "Option 24",
      );
      await trigger.press("ArrowDown");
      await expect(finalOption).toBeFocused();
      await expect(finalOption).toBeInViewport();
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("option", { name: "Option 1", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(trigger.locator('[data-slot="select-value"]')).toHaveText(
        "Option 1",
      );
      await page.close();
    }
  }
  console.log(
    "PASS: long Select menus scroll and select by pointer and keyboard on desktop and phone.",
  );
} finally {
  await browser.close();
}
