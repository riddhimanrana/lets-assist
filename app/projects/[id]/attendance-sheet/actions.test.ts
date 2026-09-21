import { beforeEach, expect, mock, test } from "bun:test";

const projectId = "a1100000-0000-4000-8000-000000000001";
const requestId = "a1200000-0000-4000-8000-000000000001";
const sheetIds = [
  "a1300000-0000-4000-8000-000000000001",
  "a1300000-0000-4000-8000-000000000002",
];
const sessions = ["morning", "afternoon"].map((id) => ({ id, label: id }));
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const reads: Array<{ table: string; filters: Record<string, string> }> = [];
let failedTable = "";
let failedSheet = "";
let accessCalls = 0;
let revokeAfterReads = false;
let denied = false;
let rpcFailure = false;
let largeRoster = false;
const admin = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return rpcFailure
      ? { data: null, error: { message: "transaction rolled back" } }
      : {
          data: sessions.map((session, index) => ({
            sheet_id: sheetIds[index],
            schedule_id: session.id,
          })),
          error: null,
        };
  },
  from: (table: string) => {
    const filters: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        filters[key] = value;
        return query;
      },
      order: () => query,
      single: async () => {
        reads.push({ table, filters: { ...filters } });
        if (failedTable === table && failedSheet === filters.id)
          return { data: null, error: { message: "read unavailable" } };
        return {
          data: {
            id: filters.id,
            project_title: "Fictional project",
            project_timezone: "UTC",
            starts_at: "2020-09-18T09:00:00Z",
            ends_at: "2020-09-18T12:00:00Z",
          },
          error: null,
        };
      },
      range: async (start: number) => {
        reads.push({ table, filters: { ...filters } });
        if (failedTable === table && failedSheet === filters.sheet_id)
          return { data: null, error: { message: "read unavailable" } };
        const count = largeRoster && start === 0 ? 500 : 1;
        return {
          data: Array.from({ length: count }, (_, offset) => ({
            row_reference: (start + offset).toString(16).padStart(12, "0"),
            row_number: start + offset + 1,
            row_kind: "signup",
            printed_name: "Fictional volunteer",
          })),
          error: null,
        };
      },
    };
    return query;
  },
};
mock.module("@/lib/attendance/print-manifest", () => ({
  attendancePrintSessions: () => sessions,
  requireAttendancePrintAccess: async () => {
    accessCalls++;
    return denied || (revokeAfterReads && accessCalls > 1)
      ? null
      : { admin, userId: "fictional-manager", project: { id: projectId } };
  },
}));
const { createAttendancePrintSheets } = await import("./actions");
const input = {
  projectId,
  requestId,
  scheduleIds: sessions.map((session) => session.id),
  blankRows: 10,
  continuationRows: 4,
};
beforeEach(() => {
  calls.length = reads.length = accessCalls = 0;
  failedTable = failedSheet = "";
  denied = revokeAfterReads = rpcFailure = largeRoster = false;
});

test("selected sessions are prepared with one scoped atomic request", async () => {
  const result = await createAttendancePrintSheets(input);
  expect(calls).toEqual([
    {
      name: "create_attendance_print_sheets",
      args: {
        p_project_id: projectId,
        p_schedule_ids: ["morning", "afternoon"],
        p_actor_id: "fictional-manager",
        p_blank_rows: 10,
        p_continuation_rows: 4,
        p_request_id: requestId,
      },
    },
  ]);
  expect(
    "sheets" in result && result.sheets.map((sheet) => sheet.sheetReference),
  ).toEqual(sheetIds);
  expect(reads.every((read) => read.filters.project_id === projectId)).toBe(
    true,
  );
  expect(accessCalls).toBe(2);
});
for (const table of [
  "project_attendance_print_sheets",
  "project_attendance_print_rows",
]) {
  test(`a later ${table} read failure retries the same durable request`, async () => {
    failedTable = table;
    failedSheet = sheetIds[1];
    expect(await createAttendancePrintSheets(input)).toHaveProperty("error");
    failedTable = failedSheet = "";
    const retry = await createAttendancePrintSheets(input);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(
      "sheets" in retry && retry.sheets.map((sheet) => sheet.sheetReference),
    ).toEqual(sheetIds);
  });
}
test("atomic preparation failure returns no partial sheets and reads no manifests", async () => {
  rpcFailure = true;
  const result = await createAttendancePrintSheets(input);
  expect(result).toHaveProperty("error");
  expect(result).not.toHaveProperty("sheets");
  expect(reads).toEqual([]);
});
test("revoked access suppresses loaded roster names", async () => {
  revokeAfterReads = true;
  expect(await createAttendancePrintSheets(input)).toEqual({
    error: "You no longer have permission to print this roster.",
  });
});
test("denied managers and unavailable sessions cannot create manifests", async () => {
  denied = true;
  expect(await createAttendancePrintSheets(input)).toHaveProperty("error");
  denied = false;
  expect(
    await createAttendancePrintSheets({ ...input, scheduleIds: ["unknown"] }),
  ).toHaveProperty("error");
  expect(calls).toEqual([]);
});
test("complete bounded pagination retains rows after the first page", async () => {
  largeRoster = true;
  const result = await createAttendancePrintSheets(input);
  expect(
    "sheets" in result && result.sheets.map((sheet) => sheet.rows.length),
  ).toEqual([501, 501]);
});
test("legacy callers can omit the new request key", async () => {
  const { requestId: omitted, ...legacyInput } = input;
  expect(omitted).toBe(requestId);
  expect(await createAttendancePrintSheets(legacyInput)).toHaveProperty(
    "sheets",
  );
  expect(calls[0].args.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
});
