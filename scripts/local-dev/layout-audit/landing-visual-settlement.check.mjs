// Pure fake-page checks only; no browser, stack, SDK, network or live receipts.
import assert from "node:assert/strict";
import {
  LANDING_LIMITS,
  landingSettlementScope,
  landingSnapshotReason,
  settleLandingVisual,
} from "./landing-visual-settlement.mjs";
const entry = {
    id: "landing-baseline",
    route: "/?noRedirect=1",
    expectedRoutes: ["/?noRedirect=1"],
  },
  base = "http://127.0.0.1:3000",
  current = base + entry.route;
let checks = 0;
function check(fn) {
  fn();
  checks++;
}
class FakePage {
  constructor(change = {}) {
    this.top = 0;
    this.resets = 0;
    this.scrolls = 0;
    this.snapshots = 0;
    this.change = change;
  }
  url() {
    return this.change.url ?? current;
  }
  async evaluate(fn, arg) {
    const code = fn.toString();
    assert(
      !/\.click\(|\.dispatchEvent\(|localStorage|sessionStorage|\.style\s*=/u.test(
        code,
      ),
    );
    if (typeof arg === "number") {
      this.top = arg;
      this.scrolls++;
      return;
    }
    if (!arg) {
      this.top = 0;
      this.resets++;
      return this.change.reset !== false;
    }
    this.snapshots++;
    return {
      height: this.change.growing
        ? 1000 + 100 * this.snapshots
        : this.change.finalGrowth && arg.allImages
          ? 1100
          : 1000,
      viewport: 400,
      top: this.top,
      fonts: true,
      foreignImages: 0,
      failedImages: 0,
      pendingImages: 0,
      footer: true,
      footerVisited: this.top >= 600,
      missingSections: 0,
      reveal: true,
      focusCleared: true,
      ...this.change.snapshot,
    };
  }
  async waitForTimeout() {
    return;
  }
}
check(() => assert(landingSettlementScope(entry, base, current)));
for (const [e, b, u] of [
  [{ ...entry, id: "home-member" }, base, current],
  [{ ...entry, actorKey: "volunteer" }, base, current],
  [{ ...entry, route: "/" }, base, current],
  [{ ...entry, expectedRoutes: ["/"] }, base, current],
  [entry, "https://lets-assist.com", current],
  [entry, "http://localhost:3000", current],
  [entry, "http://127.0.0.1:3001", current],
  [entry, base, "https://unowned.invalid/"],
  [entry, base, current + "&token=OFFLINE_ONLY"],
  [entry, base, current + "#unknown"],
])
  check(() => assert(!landingSettlementScope(e, b, u)));
const positive = new FakePage(),
  settled = await settleLandingVisual(positive, entry, base);
check(() => assert.equal(settled.status, "settled"));
check(() =>
  assert(
    settled.topRestored &&
      settled.focusCleared &&
      positive.top === 0 &&
      positive.resets === 2,
  ),
);
check(() =>
  assert(positive.scrolls > 1 && settled.steps <= LANDING_LIMITS.steps),
);
for (const [snapshot, reason] of [
  [{ foreignImages: 1 }, "nonlocal-image"],
  [{ failedImages: 1 }, "image-failed"],
  [{ footer: false }, "step-cap-or-unstable"],
  [{ missingSections: 1 }, "step-cap-or-unstable"],
  [{ reveal: false }, "step-cap-or-unstable"],
  [{ pendingImages: 1 }, "step-cap-or-unstable"],
  [{ fonts: false }, "step-cap-or-unstable"],
  [{ height: NaN }, "invalid-layout"],
  [{ footer: undefined }, "invalid-layout"],
]) {
  const fake = new FakePage({ snapshot }),
    r = await settleLandingVisual(fake, entry, base);
  check(() => assert.equal(r.status, "unsettled"));
  check(() => assert.equal(r.reason, reason));
  check(() => assert(fake.scrolls <= LANDING_LIMITS.steps));
}
for (const [change, reason] of [
  [{ growing: true }, "step-cap-or-unstable"],
  [{ finalGrowth: true }, "height-or-view-changing"],
  [{ snapshot: { focusCleared: false } }, "height-or-view-changing"],
]) {
  const rejected = await settleLandingVisual(new FakePage(change), entry, base);
  check(() => assert.equal(rejected.status, "unsettled"));
  check(() => assert.equal(rejected.reason, reason));
}
const resetFailure = await settleLandingVisual(
  new FakePage({ reset: false }),
  entry,
  base,
);
check(() => assert.equal(resetFailure.reason, "reset-cap"));
const outside = new FakePage({ url: "https://unowned.invalid/" }),
  refused = await settleLandingVisual(outside, entry, base);
check(() => assert.equal(refused.reason, "scope"));
check(() =>
  assert.equal(outside.snapshots + outside.scrolls + outside.resets, 0),
);
const originalNow = Date.now;
try {
  let time = 0;
  Date.now = () => (time += 21000);
  const timeout = await settleLandingVisual(new FakePage(), entry, base);
  check(() => assert.equal(timeout.reason, "time-cap"));
} finally {
  Date.now = originalNow;
}
check(() => assert.equal(landingSnapshotReason({}), "invalid-layout"));
console.log(
  JSON.stringify({
    offlineSettlementChecks: checks,
    browserStarted: false,
    networkStarted: false,
    stackStarted: false,
    pixelsInspected: 0,
    canonicalRuntimeProof: false,
  }),
);
