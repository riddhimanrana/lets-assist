import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  restoreCaptureRestingState,
  restingFailureDiagnostic,
} from "./capture-resting-state.mjs";

function browserStandIn(visibleAt = () => false, options = {}) {
  let now = 0,
    deadline,
    frameId = 0;
  const calls = [];
  class Element {
    blur() {
      calls.push("blur");
    }
  }
  const popup = { getClientRects: () => (visibleAt(now) ? [{}] : []) };
  const document = {
    activeElement: new Element(),
    querySelector: () => (options.skipLinkFocused ? {} : null),
    querySelectorAll(selector) {
      assert.equal(selector, '[role="tooltip"],[data-slot="tooltip-content"]');
      return [popup];
    },
  };
  const window = {
    scrollY: 100,
    scrollTo(scrollOptions) {
      assert.equal(scrollOptions.top, 0);
      if (!options.viewportAwayFromTop) this.scrollY = 0;
      calls.push("scroll");
    },
    setTimeout(fn) {
      deadline = fn;
      return 1;
    },
    clearTimeout() {
      deadline = undefined;
    },
    cancelAnimationFrame() {},
    requestAnimationFrame(fn) {
      const id = ++frameId;
      queueMicrotask(() => {
        now += 100;
        if (now >= 3000 && deadline) {
          const done = deadline;
          deadline = undefined;
          done();
          return;
        }
        fn(now);
      });
      return id;
    },
  };
  const context = vm.createContext({
    document,
    window,
    HTMLElement: Element,
    getComputedStyle: () => ({
      visibility: "visible",
      display: "block",
      opacity: "1",
    }),
  });
  const page = {
    keyboard: { press: async () => assert.fail("Preserve open dialogs") },
    mouse: {
      move: async (x, y) => {
        assert.equal(x, 0);
        assert.equal(y, 0);
        calls.push("pointer");
      },
    },
    evaluate: async (fn) => vm.runInContext("(" + fn + ")()", context),
  };
  return { page, calls, now: () => now };
}
test("resting capture clears focus/scroll and requires a quiet portal interval", async () => {
  const fixture = browserStandIn();
  const result = await restoreCaptureRestingState(fixture.page);
  assert.deepEqual(fixture.calls, ["blur", "scroll", "pointer"]);
  assert.equal(result.focusState, "resting-after-keyboard-proof");
  assert.equal(result.tooltipProbe, "role-and-component-portal");
  assert.equal(result.quietPeriodMs, 400);
  assert.equal(fixture.now(), 500);
});
test("a delayed portal with no tooltip role restarts the quiet interval", async () => {
  const fixture = browserStandIn((now) => now >= 300 && now <= 500);
  await restoreCaptureRestingState(fixture.page);
  assert.equal(fixture.now(), 1000);
});
test("an undismissed popup fails within the fixed deadline", async () => {
  const fixture = browserStandIn(() => true);
  await assert.rejects(
    restoreCaptureRestingState(fixture.page),
    /did not settle/,
  );
  assert.equal(fixture.now(), 3000);
});

for (const scenario of ["tooltip", "viewport", "skip-link"]) {
  test(`an unsettled ${scenario} retains only fixed diagnostic flags`, async () => {
    const fixture = browserStandIn(() => scenario === "tooltip", {
      viewportAwayFromTop: scenario === "viewport",
      skipLinkFocused: scenario === "skip-link",
    });
    const diagnostics = [];
    await assert.rejects(
      restoreCaptureRestingState(fixture.page, (value) =>
        diagnostics.push(value),
      ),
      /did not settle/,
    );
    assert.deepEqual(diagnostics, [
      {
        state: "unsettled",
        viewportAtTop: scenario !== "viewport",
        tooltipVisible: scenario === "tooltip",
        skipLinkFocused: scenario === "skip-link",
      },
    ]);
    assert.equal(fixture.now(), 3000);
  });
}

test("resting failure diagnostics refuse unknown fields and non-boolean flags", () => {
  const valid = {
    state: "unsettled",
    viewportAtTop: true,
    tooltipVisible: false,
    skipLinkFocused: false,
  };
  assert.deepEqual(restingFailureDiagnostic(valid), valid);
  for (const value of [
    { ...valid, privateText: "PRIVATE_COOKIE_URL" },
    { ...valid, state: "PRIVATE_COOKIE_URL" },
    { ...valid, tooltipVisible: "PRIVATE_COOKIE_URL" },
    null,
    {},
  ])
    assert.throws(() => restingFailureDiagnostic(value), /diagnostic refused/);
});
