import { expect, test, type Page } from "@playwright/test";
import { restoreCaptureRestingState } from "../../../scripts/local-dev/layout-audit/capture-resting-state.mjs";

test.use({ viewport: { width: 375, height: 812 } });

async function scrollFixture(page: Page, repeat: boolean) {
  await page.setContent(
    '<input aria-label="Fictional focus target"><div style="height:3000px"></div>',
  );
  await page.evaluate((continued) => {
    const input = document.querySelector("input")!;
    input.addEventListener(
      "blur",
      () => {
        const scroll = () =>
          window.scrollTo({
            top: 180,
            behavior: continued ? "instant" : "smooth",
          });
        if (continued) window.setInterval(scroll, 100);
        else window.setTimeout(scroll, 150);
      },
      { once: true },
    );
    input.focus({ preventScroll: true });
  }, repeat);
}

test("resting capture restores one delayed native scroll and proves a quiet top viewport", async ({
  page,
}) => {
  await scrollFixture(page, false);
  const receipt = await restoreCaptureRestingState(page);
  expect(receipt.scrollRestorations).toBe(2);
  expect(receipt.quietPeriodMs).toBe(400);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("resting capture refuses a native viewport that keeps moving", async ({
  page,
}) => {
  await scrollFixture(page, true);
  const diagnostics: unknown[] = [];
  await expect(
    restoreCaptureRestingState(page, (value: unknown) =>
      diagnostics.push(value),
    ),
  ).rejects.toThrow("did not settle");
  expect(diagnostics).toEqual([
    {
      state: "unsettled",
      viewportAtTop: false,
      tooltipVisible: false,
      skipLinkFocused: false,
    },
  ]);
});
