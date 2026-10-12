// Observe the live word/demo phase; do not freeze or disable their animations.
export function readLandingComparison() {
  const root = document.querySelector("#comparison");
  if (!root) return { ready: false, reason: "missing-comparison" };
  const words = root.querySelectorAll('[data-slot="comparison-word"] > span'),
    phases = root.querySelectorAll('[data-slot="comparison-demo-phase"]');
  if (words.length !== 1 || phases.length !== 1)
    return { ready: false, reason: "between-states" };
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
    return { ready: false, reason: "unknown-state" };
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
    documentHeight: document.documentElement?.scrollHeight ?? null,
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
export async function captureSettledPixels(page, entry) {
  if (entry.id !== "landing-baseline")
    return { pixels: await page.screenshot({ fullPage: true, caret: "hide" }) };
  if (entry.actorKey) throw Error("Public landing capture required");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = await settleLandingComparison(page),
      start = Date.now();
    const pixels = await page.screenshot({ fullPage: true, caret: "hide" }),
      elapsed = Date.now() - start;
    const after = await page.evaluate(readLandingComparison);
    // Less than a full 2.5s word cycle prevents matching a later repeat.
    if (
      elapsed < 2500 &&
      after.ready &&
      before.word === after.word &&
      before.phase === after.phase &&
      before.documentHeight === after.documentHeight
    )
      return {
        pixels,
        comparisonState: after,
        documentHeight: after.documentHeight,
        attempts: attempt,
      };
  }
  throw Error("Comparison changed during bounded PNG capture");
}
