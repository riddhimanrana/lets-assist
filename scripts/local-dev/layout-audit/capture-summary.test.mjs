import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCaptureDomReady,
  captureSummary,
  readRequestRefusalCategory,
} from "./capture-summary.mjs";

const scenes = new Map([["home-member", {}]]);
const receipt = () => ({
  finalDriftVerified: true,
  executionFailure: true,
  results: [
    {
      id: "home-member",
      mode: "phone-dark",
      status: "blocked-or-failed",
      failure: "PRIVATE_TEXT_COOKIE_TOKEN_URL",
      socketRefusals: [{ reason: "PRIVATE_TEXT_COOKIE_TOKEN_URL" }],
      faults: {
        pageErrors: 0,
        consoleErrors: 1,
        http5xx: 0,
        blockedExternal: 0,
        blockedMutation: 1,
        blockedSocket: 0,
        unsafeNavigation: 0,
        private: "PRIVATE_TEXT_COOKIE_TOKEN_URL",
      },
    },
  ],
});

test("CI summary logs only fixed scene/mode/state and bounded counters", () => {
  const summary = captureSummary(receipt(), scenes);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.images, 0);
  assert.equal(summary.blocked[0].faults.blockedMutation, 1);
  assert.equal(summary.completeVisualAudit, false);
  assert.equal(summary.pixelsInspected, 0);
  assert(!JSON.stringify(summary).includes("PRIVATE"));
});

test("refused reader requests expose only fixed classifications, never IDs or arguments", () => {
  const knownId = "a".repeat(40);
  const groups = { plugin: [{ actionId: knownId }] };
  assert.equal(
    readRequestRefusalCategory(knownId, groups),
    "reviewed-plugin-reader-refused",
  );
  assert.equal(
    readRequestRefusalCategory("PRIVATE_COOKIE_TOKEN", groups),
    "unreviewed-request",
  );
  const final = receipt();
  final.results[0].requestRefusals = ["reviewed-plugin-reader-refused"];
  const summary = captureSummary(final, scenes);
  assert.deepEqual(summary.blocked[0].requestRefusals, [
    "reviewed-plugin-reader-refused",
  ]);
  assert(!JSON.stringify(summary).includes(knownId));
  assert(!JSON.stringify(summary).includes("PRIVATE"));
  for (const invalid of [
    ["PRIVATE_URL"],
    Array(5).fill("unreviewed-request"),
    "PRIVATE_TEXT",
  ]) {
    final.results[0].requestRefusals = invalid;
    assert.throws(() => captureSummary(final, scenes));
  }
});

test("historical loading PNG receipts cannot qualify for successful CI upload", () => {
  const final = receipt();
  final.results[0].status = "captured-loading-present";
  final.results[0].image = "home-member-phone-dark.png";
  assert.throws(() => captureSummary(final, scenes), /scene refused/u);
});

test("a visible landmark or PNG does not make a still-loading scene complete", () => {
  const final = receipt();
  final.executionFailure = false;
  const row = final.results[0];
  row.status = "captured-awaiting-pixel-review";
  row.image = "home-member-phone-dark.png";
  row.dom = { mainCount: 1, h1Count: 1, loadingIndicators: 1 };
  assert.throws(() => captureSummary(final, scenes), /unresolved loading/u);
  row.dom.loadingIndicators = 0;
  assert.equal(captureSummary(final, scenes).images, 1);
});

test("only an explicit zero loading count passes the PNG preflight", () => {
  assert.doesNotThrow(() => assertCaptureDomReady({ loadingIndicators: 0 }));
  for (const value of [undefined, null, -1, 1, Infinity, NaN, "0", false])
    assert.throws(() => assertCaptureDomReady({ loadingIndicators: value }));
  assert.throws(() => assertCaptureDomReady(null));
});

for (const [name, alter] of [
  [
    "unknown scene",
    (row) => {
      row.id = "PRIVATE_TEXT";
    },
  ],
  [
    "unknown mode",
    (row) => {
      row.mode = "PRIVATE_TEXT";
    },
  ],
  [
    "unknown state",
    (row) => {
      row.status = "PRIVATE_TEXT";
    },
  ],
  [
    "secret counter",
    (row) => {
      row.faults.blockedMutation = "PRIVATE_TEXT";
    },
  ],
  [
    "unbounded counter",
    (row) => {
      row.faults.blockedMutation = Infinity;
    },
  ],
])
  test(`${name} refuses logging`, () => {
    const final = receipt();
    alter(final.results[0]);
    assert.throws(() => captureSummary(final, scenes));
  });
