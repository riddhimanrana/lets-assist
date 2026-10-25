import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { NotificationData } from "./notification-types";

const userId = "10000000-0000-4000-8000-000000000001";
const privateMarker =
  "fictional.person@example.test signed-token-fictional roster-note-fictional";
const privateError = {
  code: "42501",
  message: privateMarker,
  details: `Provider payload: ${privateMarker}`,
  hint: `https://fixture.example.test/?token=${privateMarker}`,
};
const notice: NotificationData = {
  title: privateMarker,
  body: privateMarker,
  type: "general",
  actionUrl: `/fixture?token=${privateMarker}`,
  data: { privateMarker },
  dedupeKey: privateMarker,
};
let preferenceError: unknown = null;
let insertError: unknown = null;
let thrownError: unknown = null;
let profileError: unknown = null;
let existingNoticeError: unknown = null;
let displayedError: unknown = null;
let authenticated = true;
let preferencesEnabled = true;
let inserted: unknown[] = [];
let logs: unknown[][] = [];
const consoleSpies = (["log", "info", "debug", "warn", "error"] as const).map(
  (level) =>
    spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push([level, ...args]);
    }),
);
afterAll(() => consoleSpies.forEach((spy) => spy.mockRestore()));

mock.module("server-only", () => ({}));
mock.module("sonner", () => ({ toast: { info: () => undefined } }));
mock.module("@/lib/safe-console", () => ({
  // Capture the caller's arguments before the shared helper could sanitize them.
  safeConsole: { error: (...args: unknown[]) => console.error(...args) },
}));
mock.module("@/lib/logger", () => ({
  log: (...args: unknown[]) => {
    logs.push(args);
  },
}));
const client = {
  auth: {
    getUser: async () => ({
      data: { user: authenticated ? { id: userId } : null },
      error: null,
    }),
  },
  from(table: string) {
    if (table === "notification_settings")
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                general: preferencesEnabled,
                user_id: userId,
                private_note: privateMarker,
              },
              error: preferenceError,
            }),
          }),
        }),
      };
    if (table === "profiles")
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { username: "user_fictional" },
              error: profileError,
            }),
          }),
        }),
      };
    if (table === "notifications")
      return {
        insert: async (row: unknown) => {
          if (thrownError) throw thrownError;
          inserted.push(row);
          return { data: row, error: insertError };
        },
        select: () => {
          const query = {
            eq: () => query,
            limit: async () => ({ data: [], error: existingNoticeError }),
          };
          return query;
        },
        update: () => {
          const query = {
            eq: () => query,
            then: (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) =>
              (displayedError
                ? Promise.reject(displayedError)
                : Promise.resolve({ error: null })
              ).then(resolve, reject),
          };
          return query;
        },
      };
    throw new Error("Unexpected fixture relation");
  },
};
mock.module("@/lib/supabase/client", () => ({ createClient: () => client }));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
const { NotificationService } = await import("./notifications");
const { createNotificationForUser } = await import("./notifications-server");

beforeEach(() => {
  preferenceError =
    insertError =
    thrownError =
    profileError =
    existingNoticeError =
    displayedError =
      null;
  authenticated = preferencesEnabled = true;
  inserted = [];
  logs = [];
});

function expectOnlyEvent(event: string, server = false) {
  expect(logs).toEqual([
    server ? ["error", event, { outcome: "failed" }] : ["error", event],
  ]);
  const output = JSON.stringify(logs);
  expect(output).not.toContain(privateMarker);
  expect(output).not.toContain(userId);
  expect(output).not.toContain("Provider payload");
}

describe("browser notification log privacy", () => {
  test("successful insertion keeps recipient, content and preference values out of logs", async () => {
    const result = await NotificationService.createNotification(notice, userId);
    expect(result.success).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      user_id: userId,
      title: privateMarker,
    });
    expect(logs).toEqual([]);
  });
  test("opt-out skips without logging preference values", async () => {
    preferencesEnabled = false;
    expect(
      await NotificationService.createNotification(notice, userId),
    ).toEqual({ success: false, skipped: true });
    expect(inserted).toEqual([]);
    expect(logs).toEqual([]);
  });
  test("preference failure preserves the returned error with only a static event", async () => {
    preferenceError = privateError;
    expect(
      await NotificationService.createNotification(notice, userId),
    ).toEqual({ error: privateError });
    expect(inserted).toEqual([]);
    expectOnlyEvent("Notification preferences lookup failed");
  });
  test("insert failure never logs provider messages or notification content", async () => {
    insertError = privateError;
    expect(
      await NotificationService.createNotification(notice, userId),
    ).toEqual({ error: privateError });
    expectOnlyEvent("Notification creation failed");
  });
  test("thrown transport failure never logs the exception or its stack", async () => {
    thrownError = new Error(privateMarker);
    expect(
      await NotificationService.createNotification(notice, userId),
    ).toEqual({ error: thrownError });
    expectOnlyEvent("Notification creation failed");
  });
  test("display marker failure logs no user or dedupe key", async () => {
    displayedError = privateError;
    await NotificationService.markAsDisplayed(userId, "general", privateMarker);
    expectOnlyEvent("Notification display update failed");
  });
  test("username authentication rejection is bounded", async () => {
    authenticated = false;
    await NotificationService.checkUsernameSetting(userId);
    expectOnlyEvent("Notification username authentication unavailable");
  });
  test("username profile failure omits raw error", async () => {
    profileError = privateError;
    await NotificationService.checkUsernameSetting(userId);
    expectOnlyEvent("Notification username check failed");
  });
  test("existing-notice failure omits raw error", async () => {
    existingNoticeError = privateError;
    await NotificationService.checkUsernameSetting(userId);
    expectOnlyEvent("Notification username existing notice lookup failed");
  });
});

describe("server notification log privacy", () => {
  test("preference failure emits only an event and bounded outcome", async () => {
    preferenceError = privateError;
    expect(await createNotificationForUser(notice, userId)).toEqual({
      error: privateError,
    });
    expect(inserted).toEqual([]);
    expectOnlyEvent("Notification preferences lookup failed", true);
  });
  test("insert failure preserves its result but discards provider fields from diagnostics", async () => {
    insertError = privateError;
    expect(await createNotificationForUser(notice, userId)).toEqual({
      error: privateError,
    });
    expectOnlyEvent("Notification insert failed", true);
  });
  test("exception keeps message, stack and user out of diagnostics", async () => {
    thrownError = new Error(privateMarker);
    expect(await createNotificationForUser(notice, userId)).toEqual({
      error: thrownError,
    });
    expectOnlyEvent("Notification creation failed", true);
  });
  test("successful server insert logs no notification data", async () => {
    expect(await createNotificationForUser(notice, userId)).toEqual({
      success: true,
    });
    expect(inserted).toHaveLength(1);
    expect(logs).toEqual([]);
  });
});
