// Record keyboard proof first, then photograph the real resting UI at the top.
export async function restoreCaptureRestingState(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () => {
      const visible = (element) =>
        element.getClientRects().length &&
        getComputedStyle(element).visibility !== "hidden" &&
        getComputedStyle(element).display !== "none";
      return (
        window.scrollY === 0 &&
        ![...document.querySelectorAll('[role="tooltip"]')].some(visible) &&
        !document.querySelector('[data-slot="skip-to-content"]:focus')
      );
    },
    null,
    { timeout: 3000 },
  );
  return {
    focusState: "resting-after-keyboard-proof",
    scrollTop: 0,
    tooltipsVisible: 0,
  };
}
