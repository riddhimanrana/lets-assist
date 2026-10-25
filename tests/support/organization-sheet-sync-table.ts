import { sheetSyncIntervalMinutes } from "@/lib/google-sheets/organization-sync-queue";

export type SheetSyncTableRow = {
  organization_id: string;
  sheet_id: string;
  tab_name: string;
  range_a1: string;
  report_type: string;
  layout_config: unknown;
  created_by: string;
  updated_at: string;
  auto_sync: boolean;
  sync_interval_minutes: number;
  last_synced_at: string | null;
};

export type SheetSyncBatchCall = {
  name: string;
  limit: unknown;
  runStartedAt: unknown;
  signal: AbortSignal | null;
};

export type SheetSyncBatchAnswer = {
  due_count: number;
  organization_ids: string[];
};

const BATCH_RPC = "claim_organization_sheet_sync_batch";
const SHEETS = "organization-sheet-sync";

/**
 * A stand-in for `organization_sheet_syncs`, the batch function that reads
 * it, and the two table calls the scheduled worker makes.
 *
 * The batch call answers the way the database does: it counts the
 * organizations that are enabled and due by their own interval for the run
 * start it was given, selects the next ones in id order after the Sheets
 * cursor, wraps once, and moves that cursor past what it selected. It answers
 * one call at a time, as the database lock makes the real function do. The
 * Calendar cursor is kept beside it and is never touched here.
 *
 * A load returns the rows whose ids were asked for, in id order. An update
 * changes only a row that matches every filter. A caller that sends another
 * function name, limit or run start gets an error, and its test fails.
 */
export function createSheetSyncTable() {
  const table = {
    rows: [] as SheetSyncTableRow[],
    calls: [] as SheetSyncBatchCall[],
    loads: [] as Array<{
      columns: string;
      ids: string[];
      signal: AbortSignal | null;
    }>,
    updates: [] as Array<{
      payload: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>,
    /** The last organization each worker's batch selected, kept across calls. */
    cursors: {
      "organization-calendar-sync": null,
      [SHEETS]: null,
    } as Record<string, string | null>,
    /** Fails a batch call the way a database error or a dropped request would. */
    fault: (_call: SheetSyncBatchCall, _index: number) =>
      null as null | "error" | "throw",
    /** Replaces a computed batch answer, for a database that answers wrongly. */
    answer: null as null | ((computed: SheetSyncBatchAnswer) => unknown),
    /** Replaces the rows one load returns, or fails it. */
    load: null as
      null | ((rows: SheetSyncTableRow[]) => unknown | "error" | "throw"),
    add(organizationId: string, overrides: Partial<SheetSyncTableRow> = {}) {
      const row: SheetSyncTableRow = {
        organization_id: organizationId,
        sheet_id: `sheet-${organizationId}`,
        tab_name: "Member Hours",
        range_a1: "A1",
        report_type: "member-hours",
        layout_config: null,
        created_by: "owner-1",
        updated_at: "2026-10-10T00:00:00.000Z",
        auto_sync: true,
        sync_interval_minutes: 60,
        last_synced_at: null,
        ...overrides,
      };
      table.rows.push(row);
      return row;
    },
    reset() {
      table.rows = [];
      table.calls = [];
      table.loads = [];
      table.updates = [];
      table.cursors = { "organization-calendar-sync": null, [SHEETS]: null };
      table.fault = () => null;
      table.answer = null;
      table.load = null;
    },
    rpc(name: string, args: Record<string, unknown>) {
      const call: SheetSyncBatchCall = {
        name,
        limit: args.p_limit,
        runStartedAt: args.p_run_started_at,
        signal: null,
      };
      const respond = () => {
        const index = table.calls.push(call) - 1;
        const fault = table.fault(call, index);
        if (fault === "throw" || call.signal?.aborted)
          throw new DOMException("fixture query aborted", "AbortError");
        const limit = call.limit;
        const startedAt =
          typeof call.runStartedAt === "string"
            ? Date.parse(call.runStartedAt)
            : Number.NaN;
        if (
          fault === "error" ||
          name !== BATCH_RPC ||
          typeof limit !== "number" ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 200 ||
          Number.isNaN(startedAt)
        )
          return {
            data: null,
            error: { message: "private database detail" },
          };
        const due = table.rows
          .filter(
            (row) =>
              row.auto_sync === true &&
              (row.last_synced_at === null ||
                Date.parse(row.last_synced_at) <=
                  startedAt -
                    sheetSyncIntervalMinutes(row.sync_interval_minutes) *
                      60 *
                      1000),
          )
          .map((row) => row.organization_id)
          .sort();
        const cursor = table.cursors[SHEETS];
        const ahead = due
          .filter((id) => cursor === null || id > cursor)
          .slice(0, limit);
        const wrapped = due
          .filter((id) => cursor !== null && id <= cursor)
          .slice(0, limit - ahead.length);
        const selected = [...ahead, ...wrapped];
        // The cursor moves when the batch is selected, not when it is synced.
        if (selected.length > 0)
          table.cursors[SHEETS] = selected[selected.length - 1];
        const computed = { due_count: due.length, organization_ids: selected };
        return {
          data: table.answer ? table.answer(computed) : computed,
          error: null,
        };
      };
      const request = {
        abortSignal: (signal: AbortSignal) => {
          call.signal = signal;
          return request;
        },
        then: (
          resolve: (value: ReturnType<typeof respond>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve().then(respond).then(resolve, reject),
      };
      return request;
    },
    from: (_name: string) => ({
      select: (columns: string) => ({
        in: (_column: string, ids: string[]) => {
          const load = { columns, ids, signal: null as AbortSignal | null };
          const respond = () => {
            table.loads.push(load);
            if (load.signal?.aborted)
              throw new DOMException("fixture query aborted", "AbortError");
            const rows = table.rows
              .filter((row) => ids.includes(row.organization_id))
              .sort((left, right) =>
                left.organization_id < right.organization_id ? -1 : 1,
              )
              .map((row) => ({ ...row }));
            const replaced = table.load ? table.load(rows) : rows;
            if (replaced === "throw")
              throw new DOMException("fixture query failed", "AbortError");
            return replaced === "error"
              ? { data: null, error: { message: "private database detail" } }
              : { data: replaced, error: null };
          };
          const request = {
            abortSignal: (signal: AbortSignal) => {
              load.signal = signal;
              return request;
            },
            then: (
              resolve: (value: ReturnType<typeof respond>) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => Promise.resolve().then(respond).then(resolve, reject),
          };
          return request;
        },
      }),
      update: (payload: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return query;
          },
          then: (resolve: (value: { error: null }) => unknown) => {
            table.updates.push({ payload, filters });
            // Only a row that matches every filter changes, as in Postgres.
            for (const row of table.rows) {
              const current = row as Record<string, unknown>;
              if (
                Object.entries(filters).every(
                  ([column, value]) => current[column] === value,
                )
              )
                Object.assign(row, payload);
            }
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return query;
      },
    }),
  };
  return table;
}
