export type CalendarSyncTableRow = {
  organization_id: string;
  last_synced_at: string | null;
  auto_sync?: boolean;
};

export type CalendarSyncBatchCall = {
  name: string;
  limit: unknown;
  runStartedAt: unknown;
  signal: AbortSignal | null;
};

export type CalendarSyncBatchAnswer = {
  due_count: number;
  organization_ids: string[];
};

const BATCH_RPC = "claim_organization_calendar_sync_batch";
const DUE_AFTER_MS = 60 * 60 * 1000;

/**
 * A stand-in for `organization_calendar_syncs` and the batch function that
 * reads it. It answers the way the database does: it counts the organizations
 * that are enabled and due for the run start it was given, selects the next
 * ones in id order after its saved cursor, wraps once, and moves the cursor
 * past what it selected. It answers one call at a time, as the database lock
 * makes the real function do. A caller that sends another name, limit or run
 * start gets an error, and its test fails.
 */
export function createCalendarSyncTable() {
  const table = {
    rows: [] as CalendarSyncTableRow[],
    calls: [] as CalendarSyncBatchCall[],
    /** The last organization a batch selected, kept across calls. */
    cursor: null as string | null,
    /** Fails a call the way a database error or a dropped request would. */
    fault: (_call: CalendarSyncBatchCall, _index: number) =>
      null as null | "error" | "throw",
    /** Replaces a computed answer, for a database that answers wrongly. */
    answer: null as null | ((computed: CalendarSyncBatchAnswer) => unknown),
    reset() {
      table.rows = [];
      table.calls = [];
      table.cursor = null;
      table.fault = () => null;
      table.answer = null;
    },
    rpc(name: string, args: Record<string, unknown>) {
      const call: CalendarSyncBatchCall = {
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
              (row.auto_sync ?? true) === true &&
              (row.last_synced_at === null ||
                Date.parse(row.last_synced_at) <= startedAt - DUE_AFTER_MS),
          )
          .map((row) => row.organization_id)
          .sort();
        const cursor = table.cursor;
        const ahead = due
          .filter((id) => cursor === null || id > cursor)
          .slice(0, limit);
        const wrapped = due
          .filter((id) => cursor !== null && id <= cursor)
          .slice(0, limit - ahead.length);
        const selected = [...ahead, ...wrapped];
        // The cursor moves when the batch is selected, not when it is synced.
        if (selected.length > 0) table.cursor = selected[selected.length - 1];
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
  };
  return table;
}
