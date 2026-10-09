import { beforeEach, expect, mock, test } from "bun:test";

let userId: string | null = "fictional-user";
let connection: Record<string, unknown> | null;
let connectionError: Error | null;
const requestedUsers: string[] = [];

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null } }),
    },
  }),
}));
mock.module("@/services/calendar", () => ({
  getCalendarConnection: async (id: string) => {
    requestedUsers.push(id);
    if (connectionError) throw connectionError;
    return connection;
  },
}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => undefined },
}));

const { refreshCalendarConnection } = await import("./actions");

beforeEach(() => {
  userId = "fictional-user";
  connection = null;
  connectionError = null;
  requestedUsers.length = 0;
});

test("returns only display fields from the current account's stored connection", async () => {
  connection = {
    calendar_email: "fictional.calendar@example.test",
    created_at: "2039-09-01T00:00:00Z",
    access_token: "fictional-access-ciphertext",
    refresh_token: "fictional-refresh-ciphertext",
    binding_identity_email: "fictional-private-binding@example.test",
    preferences: { private_value: "fictional-private-preference" },
    future_private_field: "fictional-future-private-value",
  };
  const result = await refreshCalendarConnection();
  expect(requestedUsers).toEqual(["fictional-user"]);
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    success: true,
    connection: {
      calendar_email: "fictional.calendar@example.test",
      created_at: "2039-09-01T00:00:00Z",
    },
  });
});

test("refuses an unauthenticated refresh before reading credentials", async () => {
  userId = null;
  await expect(refreshCalendarConnection()).rejects.toThrow("Unauthorized");
  expect(requestedUsers).toEqual([]);
});

test("reports a disconnected account without a connection payload", async () => {
  expect(await refreshCalendarConnection()).toEqual({
    success: false,
    error: "No calendar connection found",
  });
});

test("does not return provider or database diagnostics to the browser", async () => {
  connectionError = new Error("fictional-private-diagnostic");
  const result = await refreshCalendarConnection();
  expect(result).toEqual({
    success: false,
    error: "Failed to refresh connection",
  });
  expect(JSON.stringify(result)).not.toContain(connectionError.message);
});
