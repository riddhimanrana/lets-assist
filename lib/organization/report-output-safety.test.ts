import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeCsvCell,
  neutralizeSpreadsheetFormula,
} from "./report-output-safety";

test("neutralizes every spreadsheet formula-leading prefix", () => {
  for (const malicious of [
    '=HYPERLINK("https://example.test")',
    "+cmd|' /C calc'!A0",
    "-2+3",
    "@SUM(1,1)",
    "  =1+1",
    "\n=1+1",
    "\r\n\t@SUM(1,1)",
    "\u0000+1",
    "\uFEFF=1+1",
    '\t@IMPORTXML("https://example.test")',
  ]) {
    assert.equal(neutralizeSpreadsheetFormula(malicious), `'${malicious}`);
  }
});

test("CSV escaping combines formula neutralization with RFC-style quoting", () => {
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("@SUM(1,1)"), '"\'@SUM(1,1)"');
  assert.equal(escapeCsvCell('safe, "quoted"'), '"safe, ""quoted"""');
  assert.equal(escapeCsvCell("ordinary"), "ordinary");
});
