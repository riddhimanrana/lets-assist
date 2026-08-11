import assert from "node:assert/strict";
import test from "node:test";

import { writeThenClearStaleSpreadsheetValues } from "./spreadsheet-replace-core";

test("writes the replacement before clearing only stale ranges", async () => {
  const calls: string[] = [];
  const result = await writeThenClearStaleSpreadsheetValues(["tail", "right"], {
    write: async () => {
      calls.push("write");
      return true;
    },
    clear: async (range) => {
      calls.push(`clear:${range}`);
      return true;
    },
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, ["write", "clear:tail", "clear:right"]);
});

test("never clears the existing report when the replacement write fails", async () => {
  const calls: string[] = [];
  const result = await writeThenClearStaleSpreadsheetValues(["tail"], {
    write: async () => {
      calls.push("write");
      return false;
    },
    clear: async (range) => {
      calls.push(`clear:${range}`);
      return true;
    },
  });

  assert.deepEqual(result, { success: false, stage: "write" });
  assert.deepEqual(calls, ["write"]);
});
