import assert from "node:assert/strict";
import { test } from "node:test";
import { captureSummary } from "./capture-summary.mjs";

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

test("loading PNGs remain distinct from captures awaiting pixel review", () => {
  const final = receipt();
  final.results[0].status = "captured-loading-present";
  final.results[0].image = "home-member-phone-dark.png";
  const summary = captureSummary(final, scenes);
  assert.equal(summary.images, 1);
  assert.equal(summary.statusCounts["captured-loading-present"], 1);
  assert.equal(summary.statusCounts["captured-awaiting-pixel-review"], 0);
  assert.deepEqual(summary.blocked, []);
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
