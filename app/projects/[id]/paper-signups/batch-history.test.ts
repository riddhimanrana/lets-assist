import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import {
  BATCH_HISTORY_PAGE_SIZE,
  UNRESOLVED_BATCH_STATUSES,
  batchHistoryHref,
  loadBatchHistoryPage,
  readBatchHistoryCursor,
  type BatchHistoryRow,
} from "./batch-history";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
type StoredRow = BatchHistoryRow & { project_id: string };
function row(index: number, status: string, project = projectId): StoredRow {
  return {
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    project_id: project,
    schedule_id: "oneTime",
    created_at:
      status === "committed"
        ? "2026-09-20T12:00:00.123456+00:00"
        : "2026-09-01T12:00:00.123456+00:00",
    input_method: "manual",
    status,
  };
}

function fixture(rows: StoredRow[], fail = false) {
  const requests: URL[] = [];
  const client = createClient("http://attendance.local.test", "fictional-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async (input: RequestInfo | URL) => {
          const url = new URL(String(input));
          requests.push(url);
          if (fail)
            return Response.json(
              { message: "fictional provider error" },
              { status: 400 },
            );
          const params = url.searchParams;
          const statuses = params.get("status")!.slice(4, -1).split(",");
          let selected = rows.filter(
            (item) =>
              `eq.${item.project_id}` === params.get("project_id") &&
              statuses.includes(item.status),
          );
          selected.sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          );
          const filter = params.get("or");
          if (filter) {
            const match =
              /^\(created_at.lt.([^,]+),and\(created_at.eq.([^,]+),id.lt.([^)]*)\)\)$/.exec(
                filter,
              );
            if (!match || match[1] !== match[2])
              throw new Error("Unexpected cursor filter");
            selected = selected.filter(
              (item) =>
                item.created_at < match[1] ||
                (item.created_at === match[1] && item.id < match[3]),
            );
          }
          return Response.json(selected.slice(0, Number(params.get("limit"))));
        },
        { preconnect() {} },
      ),
    },
  });
  return { client, requests };
}

test("all older unresolved drafts remain reachable despite newer committed history", async () => {
  const drafts = Array.from({ length: 45 }, (_, index) =>
    row(index + 1, UNRESOLVED_BATCH_STATUSES[index % 4]),
  );
  const committed = Array.from({ length: 65 }, (_, index) =>
    row(index + 100, "committed"),
  );
  const { client, requests } = fixture([
    ...drafts,
    ...committed,
    row(999, "draft", otherProjectId),
    row(998, "discarded"),
  ]);
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await loadBatchHistoryPage(
      client,
      projectId,
      "drafts",
      cursor,
    );
    expect(page.rows.length).toBeLessThanOrEqual(BATCH_HISTORY_PAGE_SIZE);
    expect(
      page.rows.every((item) =>
        UNRESOLVED_BATCH_STATUSES.includes(item.status),
      ),
    ).toBe(true);
    found.push(...page.rows.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(found).toEqual(drafts.map((item) => item.id).reverse());
  expect(new Set(found).size).toBe(45);
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(request.searchParams.get("project_id")).toBe(`eq.${projectId}`);
    expect(request.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(request.searchParams.get("limit")).toBe("21");
  }
  const history = await loadBatchHistoryPage(client, projectId, "history");
  expect(history.rows.map((item) => item.id)).toEqual(
    committed
      .slice(-20)
      .reverse()
      .map((item) => item.id),
  );
  expect(history.nextCursor).not.toBeNull();
  expect(requests.at(-1)!.searchParams.get("status")).toBe("in.(committed)");
});

test("cursor preserves timestamp precision and rejects query syntax or malformed IDs", async () => {
  const value = `${row(1, "draft").created_at}|${row(1, "draft").id}`;
  expect(readBatchHistoryCursor(value)).toEqual([
    row(1, "draft").created_at,
    row(1, "draft").id,
  ]);
  for (const invalid of [
    undefined,
    "garbage",
    "2026-09-01T12:00:00Z|bad-id",
    `${value},status.eq.committed`,
  ]) {
    expect(readBatchHistoryCursor(invalid)).toBeNull();
    const { client, requests } = fixture([row(1, "failed")]);
    const page = await loadBatchHistoryPage(
      client,
      projectId,
      "drafts",
      invalid,
    );
    expect(page.hasCursor).toBe(false);
    expect(page.rows).toHaveLength(1);
    expect(requests[0].searchParams.has("or")).toBe(false);
  }
});

test("paging and resume links preserve the active editor and the other history cursor", () => {
  const params = {
    mode: "manual",
    batch: row(1, "draft").id,
    historyBefore: "history-cursor",
  };
  const older = new URL(
    batchHistoryHref(projectId, params, { draftsBefore: "draft-cursor" }),
    "http://attendance.local.test",
  );
  expect(older.pathname).toBe(`/projects/${projectId}/paper-signups`);
  expect(Object.fromEntries(older.searchParams)).toEqual({
    ...params,
    draftsBefore: "draft-cursor",
  });
  const newest = new URL(
    batchHistoryHref(
      projectId,
      { ...params, draftsBefore: "draft-cursor" },
      { draftsBefore: null },
    ),
    older,
  );
  expect(Object.fromEntries(newest.searchParams)).toEqual(params);
  const resume = new URL(
    batchHistoryHref(projectId, params, { batch: row(2, "draft").id }),
    older,
  );
  expect(resume.searchParams.get("batch")).toBe(row(2, "draft").id);
});

test("query failures do not masquerade as an empty draft list", async () => {
  const { client } = fixture([], true);
  await expect(
    loadBatchHistoryPage(client, projectId, "drafts"),
  ).rejects.toThrow("Could not load saved attendance batches.");
});

test("page authorizes before discovery and retains explicit batch scope and active edit key", async () => {
  const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
  expect(source.indexOf("!canManageProjectAccess({")).toBeLessThan(
    source.indexOf("const [drafts, history] = await Promise.all"),
  );
  expect(source).toContain('.eq("project_id", projectId)');
  expect(source).toContain(
    'batchQuery = batchQuery.eq("id", queryParams.batch)',
  );
  expect(source).toContain(
    'typeof queryParams.batch === "string" ? queryParams.batch : "current"',
  );
  expect(source).toContain('aria-label="Saved attendance batches"');
  expect(source).toContain('title: "Unfinished attendance drafts"');
  expect(source).toContain('title: "Saved attendance history"');
});
