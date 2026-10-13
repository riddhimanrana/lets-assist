// Observe the live word/demo phase; do not freeze or disable their animations.
export function readLandingComparison() {
  const dimensions = {
    documentHeight: document.documentElement?.scrollHeight ?? null,
    documentWidth: document.documentElement?.scrollWidth ?? null,
    viewportWidth: document.documentElement?.clientWidth ?? null,
    viewportHeight: globalThis.innerHeight ?? null,
  };
  const root = document.querySelector("#comparison");
  if (!root)
    return { ready: false, reason: "missing-comparison", ...dimensions };
  const words = root.querySelectorAll(
      '[data-slot="comparison-word"] > span:not([aria-hidden="true"])',
    ),
    phases = root.querySelectorAll('[data-slot="comparison-demo-phase"]');
  if (words.length !== 1 || phases.length !== 1)
    return { ready: false, reason: "between-states", ...dimensions };
  const word = words[0],
    phase = phases[0],
    text = word.textContent.trim(),
    name = phase.getAttribute("data-phase");
  if (
    !["sign-ups", "check-ins", "verified hours", "certificates"].includes(
      text,
    ) ||
    ![
      "browsing",
      "details",
      "qr",
      "notification",
      "certificate",
      "dashboard",
    ].includes(name)
  )
    return { ready: false, reason: "unknown-state", ...dimensions };
  const shown = (node) => {
    if (!node.getClientRects().length) return false;
    for (
      let ancestor = node;
      ancestor && ancestor !== root.parentElement;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) < 0.995
      )
        return false;
    }
    const style = getComputedStyle(node),
      matrix = new DOMMatrixReadOnly(
        style.transform === "none" ? undefined : style.transform,
      );
    return (
      [
        matrix.a - 1,
        matrix.b,
        matrix.c,
        matrix.d - 1,
        matrix.e,
        matrix.f,
      ].every((v) => Math.abs(v) < 0.1) &&
      (style.filter === "none" || /^blur\(0(?:px)?\)$/u.test(style.filter))
    );
  };
  return {
    ready: shown(word) && shown(phase),
    reason: "live-state",
    word: text,
    phase: name,
    ...dimensions,
  };
}
export async function settleLandingComparison(page) {
  // The function is serialized into the page, keeping the selectors/source fixed.
  const handle = await page.waitForFunction(
    "(() => { const state = (" +
      readLandingComparison.toString() +
      ")(); return state.ready ? state : false; })()",
    null,
    { timeout: 5000 },
  );
  const state = await handle.jsonValue();
  await handle.dispose();
  if (!state.ready) throw Error("Live comparison did not settle");
  return state;
}
// Diagnostics contain only reviewed public states and bounded numeric dimensions.
export function comparisonCaptureSnapshot(state) {
  if (!state || typeof state !== "object") return null;
  const dimension = (value) =>
    Number.isInteger(value) && value > 0 && value <= 100000 ? value : null;
  return {
    ready: state.ready === true,
    word: ["sign-ups", "check-ins", "verified hours", "certificates"].includes(
      state.word,
    )
      ? state.word
      : null,
    phase: [
      "browsing",
      "details",
      "qr",
      "notification",
      "certificate",
      "dashboard",
    ].includes(state.phase)
      ? state.phase
      : null,
    documentHeight: dimension(state.documentHeight),
    documentWidth: dimension(state.documentWidth),
    viewportWidth: dimension(state.viewportWidth),
    viewportHeight: dimension(state.viewportHeight),
  };
}
export async function captureSettledPixels(page, entry, report = () => {}) {
  if (entry.id !== "landing-baseline")
    return { pixels: await page.screenshot({ fullPage: true, caret: "hide" }) };
  if (entry.actorKey) throw Error("Public landing capture required");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const record = (category, reasons, before, after, elapsed) =>
      report({
        schema: "lets-assist-public-landing-png-attempt-v1",
        attempt,
        category,
        reasons,
        before: comparisonCaptureSnapshot(before),
        after: comparisonCaptureSnapshot(after),
        elapsedMs:
          Number.isInteger(elapsed) && elapsed >= 0 && elapsed <= 120000
            ? elapsed
            : null,
      });
    let before;
    const settleStart = Date.now();
    try {
      before = await settleLandingComparison(page);
    } catch {
      const observed = await page
        .evaluate(readLandingComparison)
        .catch(() => null);
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
      after = await page.evaluate(readLandingComparison);
    } catch {
      record("failed", ["after-state-unavailable"], before, null, elapsed);
      throw Error("Public landing post-PNG state unavailable");
    }
    // Less than a full 2.5s word cycle prevents matching a later repeat.
    const reasons = [];
    if (elapsed >= 2500) reasons.push("capture-duration");
    if (!after.ready) reasons.push("after-state-unsettled");
    if (before.word !== after.word) reasons.push("word-changed");
    if (before.phase !== after.phase) reasons.push("phase-changed");
    if (before.documentHeight !== after.documentHeight)
      reasons.push("height-changed");
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
        comparisonState: after,
        documentHeight: after.documentHeight,
        attempts: attempt,
      };
  }
  throw Error("Comparison changed during bounded PNG capture");
}
