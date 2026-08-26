import { afterEach, expect, mock, test } from "bun:test";

mock.module("@/lib/logger", () => ({
  log: () => {},
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
}));
mock.module("server-only", () => ({}));

const { acquireFencedCsfSheetSnapshots, getCsfSheetSourceSnapshot } =
  await import("./google-sheets");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("a legacy Drive quotation stays unmatched and changes the digest", async () => {
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
  expect(withThread.threadedCommentCount).toBe(0);
  expect(withThread.unmatchedThreadedCommentCount).toBe(1);
  expect(withThread.threadedCommentsByRow).toEqual({});
  expect(withThread.contentHash).not.toBe(withoutThread.contentHash);
});

test("legacy Drive quotations never bind by decoded text", async () => {
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
  expect(snapshot.threadedCommentCount).toBe(0);
  expect(snapshot.unmatchedThreadedCommentCount).toBe(2);
  expect(snapshot.threadedCommentsByRow).toEqual({});
});

test("fenced acquisition binds only provider-anchored comments inside selected ranges", async () => {
  const spreadsheetId = "synthetic-multi-tab-sheet";
  const ranges = {
    a: "'Term A'!A1:A3",
    b: "'Term B'!A1:A3",
  };
  const workbookSheets = [
    {
      properties: {
        sheetId: 10,
        title: "Term A",
        gridProperties: { rowCount: 3, columnCount: 1 },
      },
    },
    {
      properties: {
        sheetId: 11,
        title: "Term B",
        gridProperties: { rowCount: 3, columnCount: 1 },
      },
    },
  ];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const decodedUrl = decodeURIComponent(url).replaceAll("+", " ");
    if (url.includes(`/drive/v3/files/${spreadsheetId}?`)) {
      return jsonResponse({
        id: spreadsheetId,
        name: "Synthetic multi-tab workbook",
        mimeType: "application/vnd.google-apps.spreadsheet",
        modifiedTime: "2026-08-25T18:00:00.000Z",
        version: "9",
        trashed: false,
      });
    }
    if (url.includes("commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED")) {
      expect(decodedUrl).toContain("'Term A'!A1:A3");
      expect(decodedUrl).toContain("'Term B'!A1:A3");
      return jsonResponse({
        sheets: [
          {
            properties: { sheetId: 10, title: "Term A" },
            commentAnchors: [
              {
                anchorId: "term-a-anchor",
                range: {
                  sheetId: 10,
                  startRowIndex: 2,
                  endRowIndex: 3,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
              },
              {
                anchorId: "multi-cell-anchor",
                range: {
                  sheetId: 10,
                  startRowIndex: 0,
                  endRowIndex: 2,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
              },
            ],
          },
        ],
        comments: [
          {
            commentId: "term-a-thread",
            anchorId: "term-a-anchor",
            headPost: { content: "Term A officer detail" },
            status: "OPEN",
            replies: [],
          },
          {
            commentId: "multi-cell-thread",
            anchorId: "multi-cell-anchor",
            headPost: { content: "Needs manual placement" },
            status: "OPEN",
            replies: [],
          },
        ],
      });
    }
    if (url.includes("values:batchGet")) {
      const isTermA = decodedUrl.includes(ranges.a);
      return jsonResponse({
        valueRanges: [
          {
            range: isTermA ? ranges.a : ranges.b,
            values: isTermA
              ? [["Activity"], ["November meeting"], ["Term A only"]]
              : [["Activity"], ["November meeting"], ["Term B only"]],
          },
        ],
      });
    }
    if (url.includes("includeGridData=false")) {
      return jsonResponse({
        spreadsheetId,
        properties: { title: "Synthetic multi-tab workbook" },
        sheets: workbookSheets,
      });
    }

    const isTermA = decodedUrl.includes(ranges.a);
    const title = isTermA ? "Term A" : "Term B";
    return jsonResponse({
      spreadsheetId,
      sheets: [
        {
          properties: workbookSheets[isTermA ? 0 : 1].properties,
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                { values: [{ formattedValue: "Activity" }] },
                {
                  values: [
                    {
                      formattedValue: "November meeting",
                      effectiveValue: { stringValue: "November meeting" },
                    },
                  ],
                },
                {
                  values: [
                    {
                      formattedValue: `${title} only`,
                      effectiveValue: { stringValue: `${title} only` },
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

  const result = await acquireFencedCsfSheetSnapshots("token", spreadsheetId, [
    { rangeA1: "A1:A3", fallbackTabName: "Term A" },
    { rangeA1: "A1:A3", fallbackTabName: "Term B" },
  ]);

  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.unmatchedThreadedCommentCount).toBe(1);
  expect(result.snapshots[0].threadedCommentCount).toBe(1);
  expect(result.snapshots[0].threadedCommentsByRow[3]).toEqual([
    {
      columnNumber: 1,
      content: "Term A officer detail",
      replies: [],
      resolved: false,
    },
  ]);
  expect(result.snapshots[1].threadedCommentCount).toBe(0);
  expect(result.snapshots[1].threadedCommentsByRow).toEqual({});
  expect(result.snapshots[0].threadedCommentsByRow[2]).toBeUndefined();
});
