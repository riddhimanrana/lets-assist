import { describe, expect, test } from "bun:test";

import {
  chunkReportSourceIds,
  createReportSourceBudget,
  readReportSourcePages,
  REPORT_SOURCE_MAX_RECORDS,
  ReportSourceError,
  type ReportSourcePage,
} from "./source-pages";

type Row = { id: string };
const row = (index: number): Row => ({
  id: `a9113000-0000-4000-8000-${String(index).padStart(12, "0")}`,
});
const rows = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => row(from + index));

/**
 * Serves a table in id order the way the API does. `change` may alter the
 * table before a request, and `answer` may alter what one request returns.
 */
function source(
  table: Row[],
  options: {
    change?: (request: number, table: Row[]) => void;
    answer?: (
      request: number,
      page: ReportSourcePage<Row>,
    ) => ReportSourcePage<unknown>;
  } = {},
) {
  const requests: Array<{ after: string | null; limit: number }> = [];
  const fetchPage = async (after: string | null, limit: number) => {
    const request = requests.push({ after, limit });
    options.change?.(request, table);
    const matching = table
      .filter((entry) => after === null || entry.id > after)
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    const page: ReportSourcePage<Row> = {
      data: matching.slice(0, limit),
      error: null,
      // Only the first request asks for a count.
      ...(after === null ? { count: matching.length } : {}),
    };
    return (options.answer?.(request, page) ?? page) as ReportSourcePage<Row>;
  };
  return { fetchPage, requests };
}
const budget = (maxRows = REPORT_SOURCE_MAX_RECORDS) =>
  createReportSourceBudget(maxRows);
const failure = async (work: Promise<unknown>) => {
  const thrown = await work.then(
    () => null,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(ReportSourceError);
  return (thrown as ReportSourceError).reason;
};

describe("a complete read", () => {
  test("returns every row past the response cap, in bounded keyset pages", async () => {
    const { fetchPage, requests } = source(rows(1001));

    const read = await readReportSourcePages(fetchPage, budget());
    expect(read).toHaveLength(1001);
    expect(read[1000]).toEqual(row(1001));
    expect(requests).toEqual([
      { after: null, limit: 500 },
      { after: row(500).id, limit: 500 },
      { after: row(1000).id, limit: 500 },
    ]);
  });

  test("an empty source and a source that ends on a full page are both complete", async () => {
    expect(await readReportSourcePages(source([]).fetchPage, budget())).toEqual(
      [],
    );

    const full = source(rows(500));
    expect(await readReportSourcePages(full.fetchPage, budget())).toHaveLength(
      500,
    );
    // A full page is followed by one more request, which finds nothing.
    expect(full.requests).toHaveLength(2);
  });

  test("ids are split into requests of at most 200", () => {
    const chunks = chunkReportSourceIds(rows(401).map((entry) => entry.id));
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 1]);
    expect(chunks[2]).toEqual([row(401).id]);
    expect(chunkReportSourceIds([])).toEqual([]);
  });
});

describe("a read that cannot be shown to be complete fails", () => {
  const unusable: Array<
    [string, (page: ReportSourcePage<Row>) => ReportSourcePage<unknown>]
  > = [
    ["an error", (page) => ({ ...page, error: { message: "fixture" } })],
    ["no rows at all", (page) => ({ ...page, data: null })],
    [
      "more rows than asked for",
      (page) => ({ ...page, data: rows(501), count: 501 }),
    ],
    ["a count the API could not give", (page) => ({ ...page, count: null })],
    ["no count at all", (page) => ({ data: page.data, error: null })],
    ["a count as text", (page) => ({ ...page, count: "3" as never })],
    ["a negative count", (page) => ({ ...page, count: -1 })],
    ["a fractional count", (page) => ({ ...page, count: 2.5 })],
    ["a count smaller than its own page", (page) => ({ ...page, count: 2 })],
    ["a row without an id", (page) => ({ ...page, data: [row(1), {}] })],
    [
      "an id that is not text",
      (page) => ({ ...page, data: [row(1), { id: 2 }, row(3)] }),
    ],
    ["an empty id", (page) => ({ ...page, data: [row(1), { id: "" }] })],
    ["a missing row", (page) => ({ ...page, data: [row(1), null, row(3)] })],
  ];
  test.each(unusable)(
    "the first page answers with %s",
    async (_name, answer) => {
      const { fetchPage } = source(rows(3), {
        answer: (_request, page) => answer(page),
      });

      expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
        "unavailable",
      );
    },
  );

  const disordered: Array<[string, (page: Row[]) => Row[]]> = [
    ["out of order", (page) => [page[1], page[0], ...page.slice(2)]],
    ["with a repeated row", (page) => [page[0], page[0], ...page.slice(2)]],
  ];
  test.each(disordered)("a page arrives %s", async (_name, reorder) => {
    const { fetchPage } = source(rows(3), {
      answer: (_request, page) => ({ ...page, data: reorder(page.data!) }),
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "changed",
    );
  });

  test("a later page that repeats the one before it does not loop", async () => {
    const table = rows(1001);
    const { fetchPage, requests } = source(table, {
      // The second request ignores its cursor and serves the first page again.
      answer: (request, page) =>
        request === 2 ? { ...page, data: table.slice(0, 500) } : page,
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "changed",
    );
    expect(requests).toHaveLength(2);
  });

  test("a later page that fails does not leave the first pages as the result", async () => {
    const { fetchPage } = source(rows(1001), {
      answer: (request, page) =>
        request === 3 ? { data: null, error: { message: "fixture" } } : page,
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "unavailable",
    );
  });

  test("a row added after the count, where a later page reads it, is caught", async () => {
    const { fetchPage } = source(rows(1001), {
      change: (request, table) => {
        if (request === 2) table.push(row(2000));
      },
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "changed",
    );
  });

  test("a row removed after the count is caught", async () => {
    const { fetchPage } = source(rows(1001), {
      change: (request, table) => {
        if (request === 2) table.pop();
      },
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "changed",
    );
  });

  test("a short page from a response cap below the page size is caught by the count", async () => {
    // The API was asked for 500 and returned 100 of 300, with no error.
    const { fetchPage, requests } = source(rows(300), {
      answer: (_request, page) => ({ ...page, data: page.data!.slice(0, 100) }),
    });

    expect(await failure(readReportSourcePages(fetchPage, budget()))).toBe(
      "changed",
    );
    expect(requests).toHaveLength(1);
  });
});

describe("bounds", () => {
  test("a source larger than its bound is refused from the count, before the rest is fetched", async () => {
    const { fetchPage, requests } = source(rows(1001));

    expect(await failure(readReportSourcePages(fetchPage, budget(1000)))).toBe(
      "too_large",
    );
    expect(requests).toHaveLength(1);

    const exact = source(rows(1001));
    expect(
      await readReportSourcePages(exact.fetchPage, budget(1001)),
    ).toHaveLength(1001);
  });

  test("several reads share one bound", async () => {
    const shared = budget(700);

    expect(
      await readReportSourcePages(source(rows(400)).fetchPage, shared),
    ).toHaveLength(400);
    expect(
      await failure(readReportSourcePages(source(rows(301)).fetchPage, shared)),
    ).toBe("too_large");
    // What the refused read asked for was not taken from the bound.
    expect(
      await readReportSourcePages(source(rows(300)).fetchPage, shared),
    ).toHaveLength(300);
  });

  test("a first page with no count is never the start of a complete read, full or not", async () => {
    const uncounted = (table: Row[]) =>
      source(table, {
        answer: (_request, page) => ({ data: page.data, error: null }),
      });

    for (const size of [0, 3, 500, 1001]) {
      const read = uncounted(rows(size));
      expect(
        await failure(readReportSourcePages(read.fetchPage, budget())),
      ).toBe("unavailable");
      // It stops at the first page instead of reading on without a total.
      expect(read.requests).toHaveLength(1);
    }
  });
});
