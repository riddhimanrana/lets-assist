import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  readLandingComparison,
  settleLandingComparison,
  captureSettledPixels,
  comparisonCaptureSnapshot,
  observeFreshComparison,
  comparisonFreshness,
  settleFreshLandingComparison,
} from "./landing-comparison-readiness.mjs";
const freshInterval = {
  schema: "lets-assist-comparison-fresh-interval-v1",
  reducedMotion: false,
  wordTransitionObserved: true,
  phaseTransitionObserved: true,
  wordChangeObservedMsAgo: 500,
  phaseChangeObservedMsAgo: 600,
  readyUnchangedForMs: 80,
};
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
    freshness: freshInterval,
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
    freshness: freshInterval,
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

const publicState = {
  ready: true,
  word: "check-ins",
  phase: "details",
  documentHeight: 2000,
  documentWidth: 390,
  viewportWidth: 390,
  viewportHeight: 900,
  freshness: freshInterval,
};
const publicPage = () => ({
  waitForFunction: async () => ({
    jsonValue: async () => publicState,
    dispose: async () => {},
  }),
  evaluate: async () => publicState,
  screenshot: async () => Buffer.from("offline pixels"),
});

function freshObservation(read, reducedMotion = false) {
  let now = 0;
  const context = {
    performance: { now: () => now },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) {
      now += 16;
      callback();
    },
  };
  return vm.runInNewContext(
    "(" + observeFreshComparison + ")",
    context,
  )(() => read(now));
}

test("a stale opaque interval is skipped until both live transitions and a quiet ready span are observed", async () => {
  const result = await freshObservation((now) => ({
    ...publicState,
    word: now < 500 ? "sign-ups" : "verified hours",
    phase: now < 500 ? "browsing" : "qr",
    ready: now < 500 || now >= 800,
  }));
  assert.equal(result.word, "verified hours");
  assert.equal(result.phase, "qr");
  assert(result.freshness.readyUnchangedForMs >= 80);
  assert(result.freshness.wordChangeObservedMsAgo <= 700);
  assert(result.freshness.phaseChangeObservedMsAgo <= 1300);
  assert(comparisonFreshness(result.freshness, result.phase));
});

test("unchanged stale states, one-sided transitions, opacity and geometry instability all hit the fixed observation bound", async () => {
  for (const read of [
    () => publicState,
    (now) => ({ ...publicState, word: now < 500 ? "sign-ups" : "check-ins" }),
    (now) => ({ ...publicState, phase: now < 500 ? "browsing" : "qr" }),
    (now) => ({
      ...publicState,
      ready: false,
      word: now < 500 ? "sign-ups" : "check-ins",
      phase: now < 500 ? "browsing" : "qr",
    }),
    (now) => ({
      ...publicState,
      word: now < 500 ? "sign-ups" : "check-ins",
      phase: now < 500 ? "browsing" : "qr",
      documentHeight: 2000 + now,
    }),
  ])
    await assert.rejects(freshObservation(read), /within its bound/u);
});

test("natural reduced motion needs a fresh demo phase while its headline remains still", async () => {
  const result = await freshObservation(
    (now) => ({
      ...publicState,
      word: "sign-ups",
      phase: now < 500 ? "browsing" : "qr",
      ready: now < 500 || now >= 800,
    }),
    true,
  );
  assert.equal(result.freshness.reducedMotion, true);
  assert.equal(result.freshness.wordTransitionObserved, false);
  assert.equal(result.freshness.wordChangeObservedMsAgo, null);
  assert(comparisonFreshness(result.freshness, result.phase));
});

test("freshness proof rejects missing edges and stale or unbounded ages without retaining extra fields", () => {
  for (const changed of [
    { schema: "unknown" },
    { wordTransitionObserved: false },
    { phaseTransitionObserved: false },
    { wordChangeObservedMsAgo: 701 },
    { phaseChangeObservedMsAgo: 1301 },
    { readyUnchangedForMs: 79 },
    { readyUnchangedForMs: Infinity },
  ])
    assert.equal(
      comparisonFreshness({ ...freshInterval, ...changed }, "details"),
      null,
    );
  assert.deepEqual(
    comparisonFreshness({ ...freshInterval, token: "PRIVATE" }, "details"),
    freshInterval,
  );
});

test("fresh browser wait refuses a merely opaque state and always disposes its handle", async () => {
  let disposed = 0;
  await assert.rejects(
    settleFreshLandingComparison({
      async waitForFunction(expression, args, options) {
        assert.equal(typeof expression, "string");
        assert.equal(options.timeout, 16_000);
        return {
          jsonValue: async () => ({ ...publicState, freshness: undefined }),
          dispose: async () => {
            disposed++;
          },
        };
      },
    }),
    /not verified/u,
  );
  assert.equal(disposed, 1);
});

test("diagnostics discard unknown text, invalid dimensions and unrelated fields", () => {
  const result = comparisonCaptureSnapshot({
    ready: true,
    word: "private@example.test",
    phase: "secret route",
    documentHeight: Infinity,
    documentWidth: -1,
    viewportWidth: "390",
    viewportHeight: 900,
    token: "secret",
  });
  assert.deepEqual(result, {
    ready: true,
    word: null,
    phase: null,
    documentHeight: null,
    documentWidth: null,
    viewportWidth: null,
    viewportHeight: 900,
  });
  assert.equal(comparisonCaptureSnapshot(null), null);
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("slow PNGs retain all three bounded timing and state diagnostics without acceptance", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const page = publicPage(),
    rows = [];
  page.screenshot = async () => {
    now += 3000;
    return Buffer.from("offline pixels");
  };
  await assert.rejects(
    captureSettledPixels(page, { id: "landing-baseline" }, (row) =>
      rows.push(row),
    ),
    /bounded PNG/,
  );
  assert.equal(rows.length, 3);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.attempt, i + 1);
    assert.equal(row.category, "rejected");
    assert.deepEqual(row.reasons, ["capture-duration"]);
    assert.equal(row.elapsedMs, 3000);
    assert.deepEqual(row.before, publicState);
    assert.deepEqual(row.after, publicState);
  }
});
test("word, demo-phase and height changes remain separate rejection reasons", async () => {
  const page = publicPage(),
    rows = [];
  page.evaluate = async () => ({
    ...publicState,
    word: "certificates",
    phase: "certificate",
    documentHeight: 2100,
  });
  await assert.rejects(
    captureSettledPixels(page, { id: "landing-baseline" }, (row) =>
      rows.push(row),
    ),
    /bounded PNG/,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].reasons, [
    "word-changed",
    "phase-changed",
    "height-changed",
  ]);
});
for (const stage of ["screenshot", "evaluate", "waitForFunction"]) {
  test(`${stage} failure produces only the fixed public diagnostic category`, async () => {
    const page = publicPage(),
      rows = [];
    page[stage] = async () => {
      throw Error("https://private.invalid/?token=private-value");
    };
    await assert.rejects(
      captureSettledPixels(page, { id: "landing-baseline" }, (row) =>
        rows.push(row),
      ),
      /Public landing/,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, "failed");
    assert.deepEqual(rows[0].reasons, [
      stage === "screenshot"
        ? "screenshot-failed"
        : stage === "evaluate"
          ? "after-state-unavailable"
          : "before-state-unsettled",
    ]);
    assert.ok(!JSON.stringify(rows).includes("private"));
  });
}
test("accepted diagnostics retain real public dimensions and never run on a private interior", async () => {
  const page = publicPage(),
    rows = [];
  await captureSettledPixels(page, { id: "landing-baseline" }, (row) =>
    rows.push(row),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "accepted");
  assert.deepEqual(rows[0].reasons, []);
  await captureSettledPixels(page, { id: "dashboard-overview" }, () => {
    throw Error("Private diagnostic attempted");
  });
});

test("fresh phase timing reserves the same capture budget across different demo holds", () => {
  const proof = { ...freshInterval, phaseChangeObservedMsAgo: 1100 };
  assert(comparisonFreshness(proof, "details"));
  assert(comparisonFreshness(proof, "qr"));
  assert.equal(comparisonFreshness(proof, "notification"), null);
  assert.equal(comparisonFreshness(proof, "unreviewed"), null);
  assert(
    comparisonFreshness(
      { ...proof, phaseChangeObservedMsAgo: 2000 },
      "dashboard",
    ),
  );
});
