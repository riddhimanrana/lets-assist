import { afterEach, expect, mock, test } from "bun:test";

mock.module("@/lib/logger", () => ({
  log: () => {},
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
}));
mock.module("server-only", () => ({}));

const { getCsfSheetSourceSnapshot } = await import("./google-sheets");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("retains date-formatted numbers at absolute coordinates and hashes their values", async () => {
  const display = "1/9/1900 0:00:00";
  const range = "'Synthetic tab'!A1:Z1000";
  const read = async (value: number, format = "DATE_TIME") => {
    const grid = {
      spreadsheetId: "synthetic-csf-sheet",
      properties: { title: "Synthetic CSF workbook" },
      sheets: [
        {
          properties: { sheetId: 0, title: "Synthetic tab" },
          data: [
            {
              startRow: 8,
              startColumn: 3,
              rowData: [
                {
                  values: [
                    {
                      formattedValue: display,
                      effectiveValue: { numberValue: value },
                      effectiveFormat: { numberFormat: { type: format } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes("values:batchGet")
          ? { valueRanges: [{ range, values: [] }] }
          : grid,
      )) as typeof fetch;
    const result = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      "synthetic-csf-sheet",
      range,
      "Synthetic tab",
    );
    if (result.status !== "ok") throw new Error("Synthetic acquisition failed");
    return result;
  };
  const first = await read(10);
  expect(
    first.rows.find((row) => row.sourceRowNumber === 9)?.dateFormattedNumbers,
  ).toEqual({ 4: { value: 10, display } });
  expect((await read(10)).contentHash).toBe(first.contentHash);
  expect((await read(11)).contentHash).not.toBe(first.contentHash);
  expect(
    (await read(10, "NUMBER")).rows[0].dateFormattedNumbers,
  ).toBeUndefined();
});
