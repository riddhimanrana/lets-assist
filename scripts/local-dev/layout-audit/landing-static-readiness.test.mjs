import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  readLandingStatic,
  settleLandingStatic,
  landingCaptureSnapshot,
  captureSettledPixels,
} from "./landing-static-readiness.mjs";

const ready = Object.freeze({
  ready: true,
  reason: "settled",
  documentHeight: 2400,
  documentWidth: 390,
  viewportWidth: 390,
  viewportHeight: 900,
});

function observe(change = {}) {
  const body = {};
  const ids = ["journey", "org-tooling", "check-in", "partners", "cta"];
  const sections = Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        getClientRects: () => [{}],
        getBoundingClientRect: () => ({
          top: 200 + index * 300,
          width: 390,
          height: 200,
        }),
      },
    ]),
  );
  if (change.missing) delete sections[change.missing];
  if (change.reordered)
    sections.partners.getBoundingClientRect = () => ({
      top: 300,
      width: 390,
      height: 200,
    });
  const root = {
    scrollHeight: 2400,
    scrollWidth: change.overflow ? 392 : 390,
    clientWidth: 390,
    clientHeight: 900,
  };
  const document = {
    documentElement: root,
    body,
    activeElement: change.focused ? {} : body,
    fonts: { status: change.fontsPending ? "loading" : "loaded" },
    images: [],
    querySelector: (selector) =>
      selector === "#comparison" && change.oldSection ? {} : null,
    querySelectorAll: (selector) => {
      if (selector === "h1")
        return [
          {
            querySelector: () => ({
              textContent:
                change.headline ??
                "Create a volunteer project. Share one link.",
            }),
          },
        ];
      const match = /^#([a-z-]+)$/u.exec(selector);
      return match && sections[match[1]] ? [sections[match[1]]] : [];
    },
  };
  return vm.runInNewContext(`(${readLandingStatic.toString()})()`, {
    document,
    scrollY: change.scrollY ?? 0,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: change.opacity ?? "1",
    }),
  });
}

test("current landing requires the exact heading, ordered sections and stable visible geometry", () => {
  assert.equal(observe().ready, true);
  for (const change of [
    { missing: "partners" },
    { reordered: true },
    { headline: "Old landing" },
    { oldSection: true },
    { overflow: true },
    { fontsPending: true },
    { focused: true },
    { scrollY: 1 },
    { opacity: "0.3" },
  ])
    assert.equal(observe(change).ready, false, JSON.stringify(change));
});

function page(states, { screenshotError = false } = {}) {
  const reads = [...states];
  const next = () => {
    assert(reads.length, "unexpected page read");
    return reads.shift();
  };
  return {
    async waitForFunction(source, _arg, options) {
      assert(source.includes("return state.ready ? state : false"));
      assert.equal(options.timeout, 5000);
      const state = next();
      if (!state.ready) throw Error("not ready");
      return { jsonValue: async () => state, dispose: async () => {} };
    },
    async waitForTimeout(value) {
      assert.equal(value, 180);
    },
    async evaluate(fn) {
      assert.equal(fn, readLandingStatic);
      return next();
    },
    async screenshot(options) {
      assert.deepEqual(options, { fullPage: true, caret: "hide" });
      if (screenshotError) throw Error("PNG failed");
      return Buffer.from("fictional-pixels");
    },
  };
}

test("a quiet frame is required before the full-page PNG", async () => {
  assert.deepEqual(await settleLandingStatic(page([ready, ready])), ready);
  await assert.rejects(
    settleLandingStatic(page([ready, { ...ready, documentHeight: 2500 }])),
  );
  await assert.rejects(
    settleLandingStatic(page([ready, { ...ready, ready: false }])),
  );
});

test("a changing PNG frame is rejected and only a stable retry is accepted", async () => {
  const reports = [];
  const result = await captureSettledPixels(
    page([
      ready,
      ready,
      { ...ready, documentHeight: 2500 },
      ready,
      ready,
      ready,
    ]),
    { id: "landing-baseline" },
    (row) => reports.push(row),
  );
  assert.equal(result.attempts, 2);
  assert.equal(result.documentHeight, 2400);
  assert.deepEqual(
    reports.map((row) => row.category),
    ["rejected", "accepted"],
  );
  assert.deepEqual(reports[0].reasons, ["height-changed"]);
  assert(
    reports.every(
      (row) => row.schema === "lets-assist-public-landing-png-attempt-v1",
    ),
  );
});

test("unknown or unready states cannot become accepted diagnostics", async () => {
  assert.deepEqual(landingCaptureSnapshot({ ...ready, reason: "PRIVATE" }), {
    ...ready,
    reason: null,
  });
  await assert.rejects(
    captureSettledPixels(page([ready, ready, { ...ready, ready: false }]), {
      id: "landing-baseline",
    }),
  );
  await assert.rejects(
    captureSettledPixels(page([]), {
      id: "landing-baseline",
      actorKey: "member",
    }),
  );
  assert.equal(
    (
      await captureSettledPixels(page([]), { id: "dashboard-overview" })
    ).pixels.toString(),
    "fictional-pixels",
  );
});
