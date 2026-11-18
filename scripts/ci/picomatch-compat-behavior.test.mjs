import { expect, test } from "bun:test";
import { createRequire } from "node:module";

// Executes the vendored picomatch repair (vendor/picomatch-compat). The
// expected matches below were produced by unpatched picomatch 4.0.7 from the
// registry, so they pin that the repair keeps upstream matching.
const require = createRequire(import.meta.url);
const picomatch = require("../../vendor/picomatch-compat");
const tinyglobby = createRequire(require.resolve("tinyglobby"));

const inputs = [
  "",
  "a",
  "b",
  "ab",
  "ba",
  "xa",
  "xaya",
  "a.js",
  "a.js.js",
  "a.ts",
  "a/b.js",
  "abc",
  "axbybc",
  "xyz",
  "xqyqz",
  ".a",
  "b.",
  "xx.jsa.",
  "b.a",
  "src/a/b",
  "a/b/c",
  "foo",
  "x.d.ts",
  "x.ts",
];
const upstream = [
  ["+(*a)", ["a", "ba", "xa", "xaya", ".a", "b.a"]],
  ["*(a*)", ["a", "ab", "a.js", "a.js.js", "a.ts", "abc", "axbybc"]],
  ["+(?*)", []],
  ["+(a*b)", ["ab"]],
  ["*(*.js)", ["a.js", "a.js.js"]],
  ["+(x*y*z)", ["xyz", "xqyqz"]],
  ["a+(*b)c", ["abc", "axbybc"]],
  ["+(*a)?", ["a", "ba", "xa", "xaya", ".a", "b.a"]],
  ["+(*)?a", ["a", "ba", "xa", "xaya", ".a", "b.a"]],
  [".+(*a)?", [".a"]],
  ["+(*x.js)?[ab].", ["xx.jsa."]],
  ["**+(*b)?", ["b", "ab"]],
  ["*.js", ["a.js", "a.js.js"]],
  ["**/*.ts", ["a.ts", "x.d.ts", "x.ts"]],
  ["!(*.d).ts", ["a.ts", "x.ts"]],
  ["@(a|b)", ["a", "b"]],
  ["+(a|b)", ["a", "b", "ab", "ba"]],
  ["*(a|b)", ["a", "b", "ab", "ba"]],
  ["+(*(a)|*(b))", ["a", "b", "ab", "ba"]],
  ["?(foo)", ["foo"]],
  ["src/**", ["src/a/b"]],
  ["a/{b,c}/*", ["a/b/c"]],
];

test("installed consumers resolve the vendored repair", () => {
  for (const importer of [require, tinyglobby]) {
    expect(importer("picomatch/package.json").version).toBe(
      "4.0.7-lets-assist.1",
    );
  }
});

test.each(upstream)(
  "%s matches what upstream 4.0.7 matches",
  (pattern, expected) => {
    const isMatch = picomatch(pattern);
    expect(inputs.filter((input) => isMatch(input))).toEqual(expected);
  },
);

test("collapsed repeats stay bounded, so a following ? stays a lazy modifier", () => {
  expect(picomatch.makeRe("+(*a)").source).toContain("a){1}");
  expect(picomatch.makeRe("*(a*)").source).toContain("){0,1}");
  expect(picomatch.makeRe("+(*a)?").source).not.toMatch(/\)\?/u);
});

test("unsafe single-branch wildcards fall back to literal matching", () => {
  for (const pattern of ["+(!(b))", "+(**)", "*(a/*)", "+([ab]*)"]) {
    expect(picomatch(pattern)(pattern)).toBe(true);
  }
});

test.each([
  ["+(*a)", `${"a".repeat(64)}/`],
  ["+(*)", `${"x".repeat(64)}/`],
  ["*(a*)", `${"a".repeat(64)}/`],
  ["+(?*)", `${"a".repeat(64)}/`],
  ["+(!(b))", `${"a".repeat(64)}/`],
])("rejects adversarial input for %s in bounded time", (pattern, input) => {
  const isMatch = picomatch(pattern);
  const started = performance.now();
  expect(isMatch(input)).toBe(false);
  expect(performance.now() - started).toBeLessThan(250);
});
