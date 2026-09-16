import { afterEach, describe, expect, mock, test } from "bun:test";
mock.module("@/lib/logger", () => ({
  log: () => {},
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
}));
mock.module("server-only", () => ({}));
const { getCsfSheetSourceSnapshot } = await import("./google-sheets");
const SPREADSHEET_ID = "synthetic-csf-sheet";
const REQUESTED_RANGE = "'Synthetic tab'!A1:C3";
const SELECTED_VALUES = [["Name"], ["Synthetic Student"]];
function gridResponse() {
  return {
    spreadsheetId: SPREADSHEET_ID,
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: "Synthetic tab",
          gridProperties: { rowCount: 3, columnCount: 3 },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: SELECTED_VALUES.map((row) => ({
              values: row.map((value) => ({
                formattedValue: value,
                effectiveValue: { stringValue: value },
                effectiveFormat: { backgroundColor: { red: 1 } },
              })),
            })),
          },
        ],
      },
    ],
  };
}
function okHandler(values: string[][], grid: ReturnType<typeof gridResponse>) {
  return (url: string) =>
    new Response(
      JSON.stringify(
        url.includes("values:batchGet")
          ? { valueRanges: [{ range: REQUESTED_RANGE, values }] }
          : grid,
      ),
      { status: 200 },
    );
}
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function installFetch(handler: (url: string) => Response) {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    return handler(url);
  }) as typeof fetch;
  return calls;
}
describe("CSF user-entered fill styles", () => {
  test.each([
    [{ green: 1 }, "#00ff00"],
    [{ red: 1 }, "#ff0000"],
    [{ red: 1, green: 1 }, "#ffff00"],
  ])(
    "reads explicit RGB styles as officer fills: %j",
    async (rgbColor, expected) => {
      const grid = gridResponse();
      const cell = grid.sheets[0].data![0].rowData[1].values[0];
      Object.assign(cell, {
        userEnteredFormat: { backgroundColorStyle: { rgbColor } },
      });
      const calls = installFetch(okHandler(SELECTED_VALUES, grid));
      const snapshot = await getCsfSheetSourceSnapshot(
        "synthetic-token",
        SPREADSHEET_ID,
        REQUESTED_RANGE,
        "Synthetic tab",
      );
      expect(snapshot.status).toBe("ok");
      if (snapshot.status !== "ok") return;
      expect(snapshot.userEnteredFillsRead).toBe(true);
      expect(snapshot.rows[1].annotations[1].userEnteredBackground).toBe(
        expected,
      );
      const fields = new URL(
        calls.find((call) => call.url.includes("includeGridData=true"))!.url,
      ).searchParams.get("fields");
      expect(fields).toContain(
        "userEnteredFormat(backgroundColor,backgroundColorStyle)",
      );
    },
  );

  test("RGB style takes precedence over a conflicting legacy fill", async () => {
    const grid = gridResponse();
    Object.assign(grid.sheets[0].data![0].rowData[1].values[0], {
      userEnteredFormat: {
        backgroundColor: { red: 1 },
        backgroundColorStyle: { rgbColor: { green: 1 } },
      },
    });
    installFetch(okHandler(SELECTED_VALUES, grid));
    const snapshot = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    expect(snapshot.status).toBe("ok");
    if (snapshot.status === "ok")
      expect(snapshot.rows[1].annotations[1].userEnteredBackground).toBe(
        "#00ff00",
      );
  });

  test.each([1, 0])(
    "unresolved theme fills make the snapshot unavailable, including headers (row %i)",
    async (row) => {
      const grid = gridResponse();
      Object.assign(grid.sheets[0].data![0].rowData[row].values[0], {
        userEnteredFormat: {
          backgroundColor: { green: 1 },
          backgroundColorStyle: { themeColor: "ACCENT1" },
        },
      });
      installFetch(okHandler(SELECTED_VALUES, grid));
      const snapshot = await getCsfSheetSourceSnapshot(
        "synthetic-token",
        SPREADSHEET_ID,
        REQUESTED_RANGE,
        "Synthetic tab",
      );
      expect(snapshot.status).toBe("unavailable");
      expect(snapshot).not.toHaveProperty("rows");
      expect(snapshot).not.toHaveProperty("userEnteredFillsRead");
      if (snapshot.status === "unavailable")
        expect(snapshot.message).toContain("unresolved user-entered fill");
    },
  );
});
