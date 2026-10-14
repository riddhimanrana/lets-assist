// The reviewed public landing no longer mounts the animated comparison.
// Observe its exact visible structure and dimensions without changing the page.
export function readLandingStatic() {
  const sections = ["journey", "org-tooling", "check-in", "partners", "cta"];
  const root = document.documentElement;
  const dimensions = {
    documentHeight: root?.scrollHeight ?? null,
    documentWidth: root?.scrollWidth ?? null,
    viewportWidth: root?.clientWidth ?? null,
    viewportHeight: root?.clientHeight ?? null,
  };
  const refused = (reason) => ({ ready: false, reason, ...dimensions });
  if (
    !Object.values(dimensions).every(
      (value) => Number.isInteger(value) && value > 0 && value <= 100000,
    ) ||
    dimensions.documentHeight <= dimensions.viewportHeight ||
    dimensions.documentWidth > dimensions.viewportWidth + 1
  )
    return refused("dimensions");
  const headings = document.querySelectorAll("h1");
  if (
    headings.length !== 1 ||
    headings[0].querySelector(".sr-only")?.textContent?.trim() !==
      "A workspace for your volunteer organization."
  )
    return refused("headline");
  if (document.querySelector("#comparison")) return refused("old-section");
  let previousTop = -1;
  for (const id of sections) {
    const matches = document.querySelectorAll(`#${id}`);
    if (matches.length !== 1) return refused("sections");
    const section = matches[0],
      box = section.getBoundingClientRect(),
      style = getComputedStyle(section),
      top = box.top + scrollY;
    if (
      !section.getClientRects().length ||
      !Number.isFinite(top) ||
      top <= previousTop ||
      box.width < 1 ||
      box.height < 1 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      !Number.isFinite(Number(style.opacity)) ||
      Number(style.opacity) < 0.99
    )
      return refused("sections");
    previousTop = top;
  }
  if (document.fonts.status !== "loaded") return refused("fonts");
  if (
    [...document.images].some(
      (image) =>
        image.getClientRects().length &&
        image.complete &&
        image.naturalWidth === 0,
    )
  )
    return refused("images");
  if (
    scrollY !== 0 ||
    ![null, document.body, document.documentElement].includes(
      document.activeElement,
    )
  )
    return refused("resting-state");
  return { ready: true, reason: "settled", ...dimensions };
}

export async function settleLandingStatic(page) {
  const handle = await page.waitForFunction(
    "(() => { const state = (" +
      readLandingStatic.toString() +
      ")(); return state.ready ? state : false; })()",
    null,
    { timeout: 5000 },
  );
  let before;
  try {
    before = await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
  await page.waitForTimeout(180);
  const after = await page.evaluate(readLandingStatic);
  if (
    !after.ready ||
    before.documentHeight !== after.documentHeight ||
    before.documentWidth !== after.documentWidth
  )
    throw Error("Public landing did not hold a stable resting frame");
  return after;
}

const boundedDimension = (value) =>
  Number.isInteger(value) && value > 0 && value <= 100000 ? value : null;
export function landingCaptureSnapshot(state) {
  if (!state || typeof state !== "object") return null;
  return {
    ready: state.ready === true,
    reason: [
      "settled",
      "dimensions",
      "headline",
      "old-section",
      "sections",
      "fonts",
      "images",
      "resting-state",
    ].includes(state.reason)
      ? state.reason
      : null,
    documentHeight: boundedDimension(state.documentHeight),
    documentWidth: boundedDimension(state.documentWidth),
    viewportWidth: boundedDimension(state.viewportWidth),
    viewportHeight: boundedDimension(state.viewportHeight),
  };
}

export async function captureSettledPixels(page, entry, report = () => {}) {
  if (entry.id !== "landing-baseline")
    return { pixels: await page.screenshot({ fullPage: true, caret: "hide" }) };
  if (entry.actorKey) throw Error("Public landing capture required");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const record = (category, reasons, before, after, elapsedMs) =>
      report({
        schema: "lets-assist-public-landing-png-attempt-v1",
        attempt,
        category,
        reasons,
        before: landingCaptureSnapshot(before),
        after: landingCaptureSnapshot(after),
        elapsedMs:
          Number.isInteger(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 120000
            ? elapsedMs
            : null,
      });
    let before;
    const settleStart = Date.now();
    try {
      before = await settleLandingStatic(page);
    } catch {
      const observed = await page.evaluate(readLandingStatic).catch(() => null);
      record(
        "failed",
        ["before-state-unsettled"],
        null,
        observed,
        Date.now() - settleStart,
      );
      throw Error("Public landing pre-PNG state did not settle");
    }
    const start = Date.now();
    let pixels;
    try {
      pixels = await page.screenshot({ fullPage: true, caret: "hide" });
    } catch {
      record("failed", ["screenshot-failed"], before, null, Date.now() - start);
      throw Error("Public landing PNG operation failed");
    }
    const elapsed = Date.now() - start;
    let after;
    try {
      after = await page.evaluate(readLandingStatic);
    } catch {
      record("failed", ["after-state-unavailable"], before, null, elapsed);
      throw Error("Public landing post-PNG state unavailable");
    }
    const reasons = [];
    if (elapsed >= 5000) reasons.push("capture-duration");
    if (!after.ready) reasons.push("after-state-unsettled");
    if (before.documentHeight !== after.documentHeight)
      reasons.push("height-changed");
    if (before.documentWidth !== after.documentWidth)
      reasons.push("width-changed");
    record(
      reasons.length ? "rejected" : "accepted",
      reasons,
      before,
      after,
      elapsed,
    );
    if (!reasons.length)
      return {
        pixels,
        landingState: after,
        documentHeight: after.documentHeight,
        attempts: attempt,
      };
  }
  throw Error("Public landing changed during bounded PNG capture");
}
