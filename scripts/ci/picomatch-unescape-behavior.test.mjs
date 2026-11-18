import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const utilsPath = require.resolve("../../vendor/picomatch-compat/lib/utils.js");
const scanPath = require.resolve("../../vendor/picomatch-compat/lib/scan.js");
const utils = require(utilsPath);
const scan = require(scanPath);

// The former upstream expression is an oracle only for short synthetic inputs.
const upstream = (input) =>
  input.replace(/(?:\[.*?[^\\]\]|\\(?=.))/g, (match) =>
    match === "\\" ? "" : match,
  );

test("unescape preserves upstream bracket, slash and line-terminator semantics", () => {
  const alphabet = ["[", "]", "\\", "a", "\n", "\r", "\u2028", "\u2029"];
  function compare(input, remaining) {
    assert.equal(
      utils.removeBackslashes(input),
      upstream(input),
      JSON.stringify(input),
    );
    if (remaining)
      for (const char of alphabet) compare(input + char, remaining - 1);
  }
  compare("", 6);
  for (const input of [
    "a\\b",
    "[a\\b]\\x",
    "[]\\x",
    "[a\n]\\x",
    "[a\nb]\\x",
    "[\\]\\x",
    "[[]]\\x",
    "[😀]\\x",
    "\\",
  ]) {
    assert.equal(utils.removeBackslashes(input), upstream(input));
  }
});

test("scan retains default escapes and unescapes only when requested", () => {
  const input = "foo\\bar";
  assert.equal(scan(input).base, input);
  assert.equal(scan(input, { unescape: true }).base, "foobar");
});

test("public scan and helper reject quadratic work in a bounded child", () => {
  // A separate process gives this regression a real timeout even if a sync
  // regexp blocks the event loop. Include input above parse()'s unrelated cap.
  const script = `
    const assert = require('node:assert/strict');
    const scan = require(${JSON.stringify(scanPath)});
    const utils = require(${JSON.stringify(utilsPath)});
    for (const n of [32768, 262144]) {
      const brackets = '['.repeat(n);
      assert.equal(scan('\\\\' + brackets, {unescape: true}).base, brackets);
      assert.equal(utils.removeBackslashes(brackets), brackets);
      assert.equal(utils.removeBackslashes(brackets + '\\n\\\\x'), brackets + '\\nx');
    }
  `;
  execFileSync(process.execPath, ["-e", script], {
    timeout: 3000,
    stdio: "pipe",
  });
});
