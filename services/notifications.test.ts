import { beforeEach, describe, expect, mock, test } from "bun:test";

type InsertedRow = Record<string, unknown>;

let attemptedRows: InsertedRow[] = [];
let notificationSelects = 0;
let usernameCheck = false;
let notificationFilters: Array<[string, unknown]> = [];
let insertError: {
  code: string;
  details?: string;
  message: string;
} | null = null;

mock.module("sonner", () => ({
  toast: { info: () => undefined },
}));

mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: usernameCheck ? { id: USER } : null },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "notification_settings") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: null,
                error: { code: "PGRST116" },
              }),
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async (row: InsertedRow) => {
            attemptedRows.push(row);
            return { data: row, error: insertError };
          },
          select: () => {
            notificationSelects += 1;
            if (!usernameCheck) {
              throw new Error(
                "ordinary notification creation must not preflight by type",
              );
            }

            const query = {
              eq(column: string, value: unknown) {
                notificationFilters.push([column, value]);
                return query;
              },
              async limit() {
                return { data: [], error: null };
              },
            };
            return query;
          },
        };
      }

      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { username: "user_fixture" },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { NotificationService } = await import("./notifications");

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  attemptedRows = [];
  notificationSelects = 0;
  usernameCheck = false;
  notificationFilters = [];
  insertError = null;
});

describe("NotificationService.createNotification", () => {
  test("allows repeat event notifications of the same type when no key is supplied", async () => {
    await NotificationService.createNotification(
      { title: "first", body: "b", type: "project_updates" },
      USER,
    );
    await NotificationService.createNotification(
      { title: "second", body: "b", type: "project_updates" },
      USER,
    );

    expect(attemptedRows.map((row) => row.title)).toEqual(["first", "second"]);
    expect(attemptedRows.every((row) => row.dedupe_key === undefined)).toBe(
      true,
    );
    expect(notificationSelects).toBe(0);
  });

  test("persists an explicit caller-owned dedupe key", async () => {
    const result = await NotificationService.createNotification(
      {
        title: "Set Your Custom Username",
        body: "Choose a username",
        type: "general",
        dedupeKey: "account:set-custom-username",
      },
      USER,
    );

    expect(result.success).toBe(true);
    expect(attemptedRows[0]?.dedupe_key).toBe("account:set-custom-username");
  });

  test("returns a replay-safe success for the named dedupe conflict", async () => {
    insertError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "notifications_user_dedupe_key_unique"',
    };

    const result = await NotificationService.createNotification(
      {
        title: "Set Your Custom Username",
        body: "Choose a username",
        type: "general",
        dedupeKey: "account:set-custom-username",
      },
      USER,
    );

    expect(result).toEqual({ success: true, existing: true, replayed: true });
  });

  test("surfaces a different unique violation", async () => {
    insertError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "some_other_index"',
    };

    const result = await NotificationService.createNotification(
      {
        title: "Set Your Custom Username",
        body: "Choose a username",
        type: "general",
        dedupeKey: "account:set-custom-username",
      },
      USER,
    );

    expect(result).toEqual({ error: insertError });
  });

  test("opts only the custom-username nudge into stable-key deduplication", async () => {
    usernameCheck = true;

    await NotificationService.checkUsernameSetting(USER);

    expect(notificationFilters).toContainEqual(["user_id", USER]);
    expect(notificationFilters).toContainEqual([
      "dedupe_key",
      "account:set-custom-username",
    ]);
    expect(notificationFilters.some(([column]) => column === "type")).toBe(
      false,
    );
    expect(attemptedRows[0]?.dedupe_key).toBe("account:set-custom-username");
  });
});
