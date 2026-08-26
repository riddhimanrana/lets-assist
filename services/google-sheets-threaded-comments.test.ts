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

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("a uniquely quoted Drive thread binds to its source cell and changes the digest", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("values:batchGet")) {
      return jsonResponse({
        valueRanges: [
          {
            values: [
              ["First", "Last"],
              ["Rowan", "Sample"],
            ],
          },
        ],
      });
    }
    return jsonResponse({
      spreadsheetId: "synthetic-sheet",
      properties: { title: "Synthetic workbook" },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: "Synthetic tab",
            gridProperties: { rowCount: 10, columnCount: 2 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                { values: [{ formattedValue: "First" }] },
                {
                  values: [
                    {
                      formattedValue: "Rowan",
                      effectiveValue: { stringValue: "Rowan" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  }) as typeof fetch;

  const withoutThread = await getCsfSheetSourceSnapshot(
    "token",
    "synthetic-sheet",
    "'Synthetic tab'!A1:B10",
    "Synthetic tab",
  );
  const withThread = await getCsfSheetSourceSnapshot(
    "token",
    "synthetic-sheet",
    "'Synthetic tab'!A1:B10",
    "Synthetic tab",
    [
      {
        id: "synthetic-thread",
        anchor: '{"type":"workbook-range","range":"synthetic"}',
        quotedHtml: "<div>Rowan</div>",
        content: "Synthetic exception detail",
        resolved: false,
        replies: [
          { id: "synthetic-reply", content: "Synthetic officer reply" },
        ],
      },
    ],
  );

  expect(withoutThread.status).toBe("ok");
  expect(withThread.status).toBe("ok");
  if (withoutThread.status !== "ok" || withThread.status !== "ok") return;
  expect(withThread.threadedCommentCount).toBe(1);
  expect(withThread.unmatchedThreadedCommentCount).toBe(0);
  expect(withThread.threadedCommentsByRow[2]).toEqual([
    {
      columnNumber: 1,
      content: "Synthetic exception detail",
      replies: ["Synthetic officer reply"],
      resolved: false,
    },
  ]);
  expect(withThread.contentHash).not.toBe(withoutThread.contentHash);
});

test("Drive quotations decode entities once without reconstructing nested markup", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("values:batchGet")) {
      return jsonResponse({
        valueRanges: [
          {
            values: [
              ["Quoted value"],
              ["&lt;script&gt;"],
              ["<script>alert(1)</script>"],
            ],
          },
        ],
      });
    }
    return jsonResponse({
      spreadsheetId: "synthetic-sheet",
      properties: { title: "Synthetic workbook" },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: "Synthetic tab",
            gridProperties: { rowCount: 10, columnCount: 1 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                { values: [{ formattedValue: "Quoted value" }] },
                {
                  values: [
                    {
                      formattedValue: "&lt;script&gt;",
                      effectiveValue: { stringValue: "&lt;script&gt;" },
                    },
                  ],
                },
                {
                  values: [
                    {
                      formattedValue: "<script>alert(1)</script>",
                      effectiveValue: {
                        stringValue: "<script>alert(1)</script>",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  }) as typeof fetch;

  const snapshot = await getCsfSheetSourceSnapshot(
    "token",
    "synthetic-sheet",
    "'Synthetic tab'!A1:A10",
    "Synthetic tab",
    [
      {
        id: "single-pass-entity",
        anchor: '{"type":"workbook-range","range":"synthetic-one"}',
        quotedHtml: "<div>&amp;lt;script&amp;gt;</div>",
        content: "Encoded entity stays text",
        resolved: false,
        replies: [],
      },
      {
        id: "literal-script-text",
        anchor: '{"type":"workbook-range","range":"synthetic-two"}',
        quotedHtml: "<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>",
        content: "Literal markup-like cell text",
        resolved: true,
        replies: [],
      },
    ],
  );

  expect(snapshot.status).toBe("ok");
  if (snapshot.status !== "ok") return;
  expect(snapshot.threadedCommentCount).toBe(2);
  expect(snapshot.unmatchedThreadedCommentCount).toBe(0);
  expect(snapshot.threadedCommentsByRow[2]?.[0]?.content).toBe(
    "Encoded entity stays text",
  );
  expect(snapshot.threadedCommentsByRow[3]?.[0]?.content).toBe(
    "Literal markup-like cell text",
  );
});
