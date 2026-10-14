import assert from "node:assert/strict";
import { test } from "node:test";
import {
  publicPageErrorDiagnostic,
  pageErrorPhases,
  recordPageError,
} from "./page-error-diagnostics.mjs";

const baseURL = "http://127.0.0.1:3000";
const asset = `${baseURL}/_next/static/chunks/4738-0123456789abcdef.js`;
const options = { baseURL, phase: "keyboard", scriptURLs: new Set([asset]) };
test("a delivered local generated asset identifies the bounded source and phase", () => {
  const result = publicPageErrorDiagnostic(
    {
      name: "TypeError",
      message: "Cannot read properties of null (reading PRIVATE_FIELD)",
      stack: `PRIVATE_FUNCTION (${asset}:1:39241)`,
    },
    options,
  );
  assert.deepEqual(result, {
    schema: "lets-assist-public-page-error-v1",
    phase: "keyboard",
    kind: "TypeError",
    category: "property-access",
    source: { file: "4738-0123456789abcdef.js", line: 1, column: 39241 },
  });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
for (const [name, message, category] of [
  ["Error", "Minified React error #185; private details", "react-minified"],
  ["Error", "Maximum update depth exceeded private", "react-update-depth"],
  ["ReferenceError", "PRIVATE_ACTOR is not defined", "missing-reference"],
  ["Error", "Loading chunk 312 failed private", "chunk-load"],
  [
    "Error",
    "Failed to fetch dynamically imported module: private",
    "chunk-load",
  ],
  ["Error", "ResizeObserver loop completed private", "resize-observer"],
])
  test(`classifies ${category} without retaining source text`, () => {
    const result = publicPageErrorDiagnostic(
      { name, message, stack: "private" },
      options,
    );
    assert.equal(result.category, category);
    if (category === "react-minified") assert.equal(result.reactCode, 185);
    assert.ok(!JSON.stringify(result).includes("private"));
  });
for (const [label, url] of [
  [
    "foreign",
    "https://private.example/_next/static/chunks/4738-0123456789abcdef.js",
  ],
  ["not delivered", `${baseURL}/_next/static/chunks/9999-0123456789abcdef.js`],
  ["query", `${asset}?private=TOKEN`],
  ["private filename", `${baseURL}/_next/static/chunks/PRIVATE_ACTOR.js`],
  ["other path", `${baseURL}/private/4738-0123456789abcdef.js`],
])
  test(`refuses ${label} stack locations`, () => {
    const result = publicPageErrorDiagnostic(
      { name: "Error", message: "private", stack: `at private (${url}:1:10)` },
      {
        ...options,
        scriptURLs:
          label === "not delivered" ? options.scriptURLs : new Set([url]),
      },
    );
    assert.equal(result.source, null);
    assert.ok(!JSON.stringify(result).includes("private"));
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  });
test("untrusted names, phases, getters and oversized private text do not enter receipts", () => {
  const error = {
    name: "PRIVATE_ACTOR",
    message: "PRIVATE_TOKEN".repeat(2000),
    get stack() {
      throw Error("PRIVATE");
    },
  };
  const result = publicPageErrorDiagnostic(error, {
    ...options,
    phase: "PRIVATE_PHASE",
  });
  assert.equal(result.kind, "other");
  assert.equal(result.phase, "unknown");
  assert.equal(result.category, "unclassified");
  assert.equal(result.source, null);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
test("zero locations and missing errors fail closed to no source", () => {
  assert.equal(
    publicPageErrorDiagnostic({ stack: `${asset}:0:0` }, options).source,
    null,
  );
  assert.equal(publicPageErrorDiagnostic(null, options).source, null);
  assert.ok(Object.isFrozen(pageErrorPhases));
});

test("every event remains fatal after the diagnostic bound is reached", () => {
  const faults = { pageErrors: 0 };
  const capture = {};
  for (let i = 0; i < 7; i++)
    recordPageError(new TypeError("PRIVATE"), {
      ...options,
      faults,
      capture,
      publicLanding: true,
    });
  assert.equal(faults.pageErrors, 7);
  assert.equal(capture.pageErrorDiagnostics.length, 3);
  assert.ok(Object.values(faults).some((count) => count !== 0));
  assert.ok(!JSON.stringify(capture).includes("PRIVATE"));
});

test("private interiors count errors without inspecting or retaining them", () => {
  let inspected = false;
  const error = {
    get message() {
      inspected = true;
      return "PRIVATE";
    },
  };
  const faults = { pageErrors: 0 };
  const capture = {};
  recordPageError(error, { faults, capture, publicLanding: false });
  assert.equal(faults.pageErrors, 1);
  assert.deepEqual(capture, {});
  assert.equal(inspected, false);
});
