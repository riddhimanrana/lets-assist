import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  readLandingComparison,
  settleLandingComparison,
  captureSettledPixels,
} from "./landing-comparison-readiness.mjs";
function observed({
  word = "sign-ups",
  phase = "browsing",
  opacity = "1",
  wordCount = 1,
  phaseCount = 1,
  displaced = false,
} = {}) {
  const outside = {},
    root = {
      parentElement: outside,
      querySelectorAll: (selector) =>
        selector.includes("comparison-word")
          ? Array(wordCount).fill(text)
          : Array(phaseCount).fill(panel),
    };
  const text = {
      textContent: word,
      parentElement: root,
      getClientRects: () => [{}],
    },
    panel = {
      parentElement: root,
      getClientRects: () => [{}],
      getAttribute: () => phase,
    };
  class Matrix {
    constructor() {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = displaced ? 5 : 0;
    }
  }
  return vm.runInNewContext("(" + readLandingComparison + ")()", {
    document: { querySelector: () => root },
    getComputedStyle: () => ({
      opacity,
      display: "block",
      visibility: "visible",
      transform: "none",
      filter: "none",
    }),
    DOMMatrixReadOnly: Matrix,
  });
}
test("a full live word and opaque demo phase are required", () => {
  assert.equal(observed().ready, true);
  for (const change of [
    { wordCount: 0 },
    { phaseCount: 0 },
    { phaseCount: 2 },
    { opacity: "0.3" },
    { displaced: true },
    { word: "unreviewed" },
    { phase: "unknown" },
  ])
    assert.equal(observed(change).ready, false);
});
test("the wait tests readiness rather than treating a state object as truthy", async () => {
  const page = {
    async waitForFunction(expression, args, options) {
      assert.equal(typeof expression, "string");
      assert.ok(expression.includes("return state.ready ? state : false"));
      assert.equal(options.timeout, 5000);
      return { jsonValue: async () => observed(), dispose: async () => {} };
    },
  };
  assert.equal((await settleLandingComparison(page)).ready, true);
});
test("an unresolved live animation remains unaccepted", async () => {
  await assert.rejects(
    settleLandingComparison({
      waitForFunction: async () => {
        throw Error("not settled");
      },
    }),
  );
});
test("a screenshot taken across a live flip is retried within the fixed bound", async () => {
  let reads = 0,
    shots = 0;
  const state = {
    ready: true,
    word: "sign-ups",
    phase: "browsing",
    documentHeight: 2000,
  };
  const page = {
    waitForFunction: async () => ({
      jsonValue: async () => state,
      dispose: async () => {},
    }),
    evaluate: async () => (++reads === 1 ? { ...state, ready: false } : state),
    screenshot: async () => {
      shots++;
      return Buffer.from("offline pixels");
    },
  };
  const result = await captureSettledPixels(page, { id: "landing-baseline" });
  assert.equal(shots, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.documentHeight, 2000);
});
test("repeated changing frames never become accepted PNGs", async () => {
  let shots = 0;
  const state = {
    ready: true,
    word: "sign-ups",
    phase: "browsing",
    documentHeight: 2000,
  };
  const page = {
    waitForFunction: async () => ({
      jsonValue: async () => state,
      dispose: async () => {},
    }),
    evaluate: async () => ({ ...state, ready: false }),
    screenshot: async () => {
      shots++;
      return Buffer.from("offline pixels");
    },
  };
  await assert.rejects(
    captureSettledPixels(page, { id: "landing-baseline" }),
    /bounded PNG/,
  );
  assert.equal(shots, 3);
});
test("private interiors retain their ordinary screenshot and public landing rejects an actor", async () => {
  let shots = 0;
  const page = {
    screenshot: async () => {
      shots++;
      return Buffer.from("offline pixels");
    },
  };
  await captureSettledPixels(page, { id: "dashboard-overview" });
  assert.equal(shots, 1);
  await assert.rejects(
    captureSettledPixels(page, {
      id: "landing-baseline",
      actorKey: "developer",
    }),
  );
  assert.equal(shots, 1);
});
