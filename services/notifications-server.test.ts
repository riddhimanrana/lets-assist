import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

mock.module("server-only", () => ({}));

/**
 * Server-side notification delivery.
 *
 * The point of this module is that consequential notifications are written with
 * the service-role client rather than the browser client. That distinction is
 * not cosmetic: the browser client carries no session on the server, so
 * `auth.uid()` is NULL, and the only reason those inserts ever succeeded was an
 * `OR (auth.uid() IS NULL)` disjunct in the notifications INSERT policy — the
 * same disjunct that let anyone holding the public anon key inject a
 * notification for any user (AUD-002). These tests pin the replacement so the
 * policy can be tightened without breaking cancellation or moderation.
 */

type InsertedRow = Record<string, unknown>;

let insertedRows: InsertedRow[] = [];
let preferenceRow: Record<string, unknown> | null = null;
let preferenceError: { code: string } | null = null;
let insertError: {
  code: string;
  details?: string;
  message: string;
} | null = null;
let browserClientCalls = 0;

mock.module("@/lib/supabase/client", () => ({
  createClient: () => {
    browserClientCalls += 1;
    throw new Error(
      "the server notification path must never construct the browser client",
    );
  },
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === "notification_settings") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: preferenceRow,
                error: preferenceError,
              }),
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async (row: InsertedRow) => {
            insertedRows.push(row);
            return { data: row, error: insertError };
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { createNotificationForUser } = await import("./notifications-server");

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  insertedRows = [];
  preferenceRow = null;
  preferenceError = null;
  insertError = null;
  browserClientCalls = 0;
});

describe("createNotificationForUser", () => {
  test("writes through the service-role client and never the browser client", async () => {
    const result = await createNotificationForUser(
      {
        title: "Project Status Update",
        body: "Your signup was rejected",
        type: "project_updates",
        severity: "warning",
        actionUrl: "/projects/abc",
        data: { projectId: "abc" },
      },
      USER,
    );

    expect(result).toEqual({ success: true });
    expect(browserClientCalls).toBe(0);
    expect(insertedRows).toHaveLength(1);
  });

  test("persists every column the notification UI reads", async () => {
    await createNotificationForUser(
      {
        title: "Update on your report",
        body: "Your report was reviewed",
        type: "general",
        severity: "info",
        actionUrl: "/projects/xyz",
        data: { kind: "moderation_report_update" },
      },
      USER,
    );

    expect(insertedRows[0]).toEqual({
      user_id: USER,
      title: "Update on your report",
      body: "Your report was reviewed",
      type: "general",
      severity: "info",
      action_url: "/projects/xyz",
      data: { kind: "moderation_report_update" },
      dedupe_key: undefined,
      displayed: false,
      read: false,
    });
  });

  test("defaults severity to info when the caller omits it", async () => {
    await createNotificationForUser(
      { title: "t", body: "b", type: "general" },
      USER,
    );

    expect(insertedRows[0]?.severity).toBe("info");
  });

  test("honours a disabled notification preference", async () => {
    preferenceRow = { project_updates: false, email_notifications: true };

    const result = await createNotificationForUser(
      { title: "t", body: "b", type: "project_updates" },
      USER,
    );

    expect(result).toEqual({ success: false, skipped: true });
    expect(insertedRows).toHaveLength(0);
  });

  test("delivers when the preference row is absent", async () => {
    preferenceError = { code: "PGRST116" };

    await createNotificationForUser(
      { title: "t", body: "b", type: "project_updates" },
      USER,
    );

    expect(insertedRows).toHaveLength(1);
  });

  test("delivers repeat notifications of the same type", async () => {
    // The browser service suppresses any notification whose (user_id, type)
    // pair already exists, with no other filter — so a volunteer rejected twice
    // was told once, forever. Server-side delivery is per event.
    await createNotificationForUser(
      { title: "first", body: "b", type: "project_updates" },
      USER,
    );
    await createNotificationForUser(
      { title: "second", body: "b", type: "project_updates" },
      USER,
    );

    expect(insertedRows.map((row) => row.title)).toEqual(["first", "second"]);
  });

  test("persists an explicit dedupe key", async () => {
    await createNotificationForUser(
      {
        title: "Set Your Custom Username",
        body: "Choose a username",
        type: "general",
        dedupeKey: "account:set-custom-username",
      },
      USER,
    );

    expect(insertedRows[0]?.dedupe_key).toBe("account:set-custom-username");
  });

  test("classifies the named dedupe conflict as a replay", async () => {
    insertError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "notifications_user_dedupe_key_unique"',
    };

    const result = await createNotificationForUser(
      {
        title: "Set Your Custom Username",
        body: "Choose a username",
        type: "general",
        dedupeKey: "account:set-custom-username",
      },
      USER,
    );

    expect(result).toEqual({ success: true, replayed: true });
  });

  test("does not hide an unrelated unique violation", async () => {
    insertError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "some_other_index"',
    };

    const result = await createNotificationForUser(
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
});

describe("server notification callers", () => {
  const repoRoot = join(import.meta.dir, "..");

  for (const relativePath of [
    "app/projects/[id]/server/cancellation.ts",
    "app/admin/moderation/server/notifications.ts",
    "app/admin/moderation/server/reports.ts",
  ]) {
    test(`${relativePath} does not reach the database through the browser client`, () => {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");

      expect(source).toContain("@/services/notifications-server");
      // The browser service pulls in @/lib/supabase/client and sonner, neither
      // of which belongs in a server-only module.
      expect(source).not.toMatch(/from\s+["']@\/services\/notifications["']/u);
      expect(source).not.toMatch(/from\s+["']@\/lib\/supabase\/client["']/u);
    });
  }
});
