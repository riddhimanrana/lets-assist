// Record keyboard proof first, then photograph the real resting UI at the top.
export function restingFailureDiagnostic(value) {
  const flags = ["viewportAtTop", "tooltipVisible", "skipLinkFocused"];
  if (
    !value ||
    value.state !== "unsettled" ||
    Object.keys(value).length !== 4 ||
    Object.keys(value).some((key) => !["state", ...flags].includes(key)) ||
    flags.some((key) => typeof value[key] !== "boolean")
  )
    throw Error("Resting capture diagnostic refused");
  return {
    state: "unsettled",
    ...Object.fromEntries(flags.map((key) => [key, value[key]])),
  };
}

/**
 * @param {*} page
 * @param {(diagnostic: object) => void} [onFailure]
 */
export async function restoreCaptureRestingState(page, onFailure = () => {}) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.mouse.move(0, 0);
  const result = await page.evaluate(async () => {
    const visible = (element) =>
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== "hidden" &&
      getComputedStyle(element).display !== "none" &&
      Number(getComputedStyle(element).opacity) > 0;
    const sample = () => ({
      state: "unsettled",
      viewportAtTop: window.scrollY === 0,
      tooltipVisible: [
        ...document.querySelectorAll(
          '[role="tooltip"],[data-slot="tooltip-content"]',
        ),
      ].some(visible),
      skipLinkFocused: Boolean(
        document.querySelector('[data-slot="skip-to-content"]:focus'),
      ),
    });
    return new Promise((resolve) => {
      let quietSince = null;
      let scrollRestorations = 1;
      let frame;
      const deadline = window.setTimeout(() => {
        window.cancelAnimationFrame(frame);
        try {
          resolve(sample());
        } catch {
          resolve(null);
        }
      }, 3000);
      const observe = (now) => {
        // Base UI removes a popup's role while its portal can still paint
        // an exit animation. Observe both identities through a quiet period.
        const diagnostic = sample();
        // A late focus/tour scroll can follow the initial restoration. Allow
        // one more real scroll, then prove the actual viewport stays at zero.
        // Continued drift still fails within the original deadline.
        if (!diagnostic.viewportAtTop && scrollRestorations < 2) {
          scrollRestorations++;
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        }
        const settled =
          diagnostic.viewportAtTop &&
          !diagnostic.tooltipVisible &&
          !diagnostic.skipLinkFocused;
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
            scrollRestorations,
          });
          return;
        }
        frame = window.requestAnimationFrame(observe);
      };
      frame = window.requestAnimationFrame(observe);
    });
  });
  if (result === null || result?.state === "unsettled") {
    if (result) onFailure(restingFailureDiagnostic(result));
    throw Error("Resting capture did not settle");
  }
  return result;
}
