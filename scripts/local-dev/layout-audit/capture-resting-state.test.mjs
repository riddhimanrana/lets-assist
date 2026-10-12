import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { restoreCaptureRestingState } from "./capture-resting-state.mjs";

test("resting capture dismisses tooltips and restores scrolling without disabling keyboard controls", async () => {
  const calls = [];
  class Element {
    blur() {
      calls.push("blur");
    }
  }
  const document = {
    activeElement: new Element(),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const window = {
    scrollY: 100,
    scrollTo(options) {
      assert.equal(options.top, 0);
      assert.equal(options.behavior, "instant");
      this.scrollY = 0;
      calls.push("scroll");
    },
  };
  const context = vm.createContext({ document, window, HTMLElement: Element });
  const page = {
    keyboard: {
      press: async () =>
        assert.fail("Resting capture must preserve open dialogs"),
    },
    mouse: {
      move: async (x, y) => {
        assert.equal(x, 0);
        assert.equal(y, 0);
        calls.push("pointer");
      },
    },
    evaluate: async (fn) => vm.runInContext(`(${fn})()`, context),
    waitForFunction: async (fn, arg, options) => {
      assert.equal(options.timeout, 3000);
      assert.equal(vm.runInContext(`(${fn})()`, context), true);
      calls.push("settled");
    },
  };
  const result = await restoreCaptureRestingState(page);
  assert.deepEqual(calls, ["blur", "scroll", "pointer", "settled"]);
  assert.equal(result.focusState, "resting-after-keyboard-proof");
});

test("an undismissed tooltip stops the resting capture", async () => {
  const page = {
    keyboard: { press: async () => {} },
    evaluate: async () => {},
    mouse: { move: async () => {} },
    waitForFunction: async () => {
      throw Error("UI did not settle");
    },
  };
  await assert.rejects(restoreCaptureRestingState(page));
});
