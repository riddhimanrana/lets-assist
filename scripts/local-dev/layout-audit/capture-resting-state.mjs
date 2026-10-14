// Record keyboard proof first, then photograph the real resting UI at the top.
export async function restoreCaptureRestingState(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.mouse.move(0, 0);
  return page.evaluate(async () => {
    const visible = (element) =>
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== "hidden" &&
      getComputedStyle(element).display !== "none" &&
      Number(getComputedStyle(element).opacity) > 0;
    return new Promise((resolve, reject) => {
      let quietSince = null;
      let frame;
      const deadline = window.setTimeout(() => {
        window.cancelAnimationFrame(frame);
        reject(Error("Resting capture did not settle"));
      }, 3000);
      const observe = (now) => {
        // Base UI removes a popup's role while its portal can still paint
        // an exit animation. Observe both identities through a quiet period.
        const settled =
          window.scrollY === 0 &&
          ![
            ...document.querySelectorAll(
              '[role="tooltip"],[data-slot="tooltip-content"]',
            ),
          ].some(visible) &&
          !document.querySelector('[data-slot="skip-to-content"]:focus');
        if (!settled) quietSince = null;
        else if (quietSince === null) quietSince = now;
        if (quietSince !== null && now - quietSince >= 400) {
          window.clearTimeout(deadline);
          resolve({
            focusState: "resting-after-keyboard-proof",
            scrollTop: 0,
            tooltipsVisible: 0,
            tooltipProbe: "role-and-component-portal",
            quietPeriodMs: 400,
          });
          return;
        }
        frame = window.requestAnimationFrame(observe);
      };
      frame = window.requestAnimationFrame(observe);
    });
  });
}
