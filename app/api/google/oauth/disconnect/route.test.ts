import { beforeEach, expect, mock, test } from "bun:test";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";

let userId: string | null;
const order: string[] = [];
const prepared = {
  connectionId: "fictional-connection",
  updatedAt: "2026-10-07T00:00:00.000Z",
};
const prepare = mock(async (_userId: string) => {
  order.push("prepare");
  return prepared;
});
const deactivate = mock(async (_userId: string, _options: unknown) => {
  order.push("disconnect");
  return {
    success: true,
    remoteRevocation: "revoked",
    localCleanup: "removed",
    error: undefined as string | undefined,
  };
});
const from = mock(() => {
  throw new Error("Disconnect must preserve existing event references.");
});
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from,
  }),
}));
mock.module("@/services/personal-calendar/disconnect", () => ({
  preparePersonalCalendarDisconnect: prepare,
}));
mock.module("@/services/calendar", () => ({
  deactivateGoogleConnection: deactivate,
}));
const { POST } = await import("./route");
function request(revokeAccess = true) {
  return new Request("https://lets-assist.test/api/google/oauth/disconnect", {
    method: "POST",
    body: JSON.stringify({ revoke_access: revokeAccess, user_id: "forged" }),
  });
}
beforeEach(() => {
  userId = "fictional-user";
  order.length = 0;
  from.mockClear();
  prepare.mockClear();
  deactivate.mockClear();
  prepare.mockImplementation(async () => {
    order.push("prepare");
    return prepared;
  });
  deactivate.mockImplementation(async () => {
    order.push("disconnect");
    return {
      success: true,
      remoteRevocation: "revoked",
      localCleanup: "removed",
      error: undefined,
    };
  });
});

test("disconnect authenticates before inspecting or revoking a connection", async () => {
  userId = null;
  expect((await POST(request())).status).toBe(401);
  expect(prepare).not.toHaveBeenCalled();
  expect(deactivate).not.toHaveBeenCalled();
});

test.each([true, false])(
  "disconnect preserves event links and prepares cleanup before revocation=%s",
  async (revokeAccess) => {
    const response = await POST(request(revokeAccess));
    expect(response.status).toBe(200);
    expect(order).toEqual(["prepare", "disconnect"]);
    expect(prepare).toHaveBeenCalledWith("fictional-user");
    expect(deactivate).toHaveBeenCalledWith("fictional-user", {
      revokeAccess,
      expectedConnection: {
        id: prepared.connectionId,
        updatedAt: prepared.updatedAt,
      },
    });
    expect(from).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ success: true });
  },
);

test.each([409, 503])(
  "unconfirmed cleanup preparation HTTP%s preserves the credential",
  async (status) => {
    prepare.mockImplementation(async () => {
      throw new CalendarSyncError(
        "Cleanup could not be preserved. Retry shortly.",
        status,
      );
    });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(deactivate).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  },
);

test("a concurrently changed connection never reports successful disconnect", async () => {
  deactivate.mockImplementation(async () => ({
    success: false,
    remoteRevocation: "revoked",
    localCleanup: "failed",
    error: "Google connection changed. Refresh the page and try again.",
  }));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({
    error: "Google connection changed. Refresh the page and try again.",
  });
  expect(from).not.toHaveBeenCalled();
});

test.each([
  "{",
  "null",
  "[]",
  '{"revoke_access":"false"}',
  '{"revoke_access":null}',
])("invalid options %s cannot revoke provider access", async (body) => {
  const response = await POST(
    new Request("https://lets-assist.test/api/google/oauth/disconnect", {
      method: "POST",
      body,
    }),
  );
  expect(response.status).toBe(400);
  expect(prepare).not.toHaveBeenCalled();
  expect(deactivate).not.toHaveBeenCalled();
});

test("an empty UI request retains the default revocation behavior", async () => {
  const response = await POST(
    new Request("https://lets-assist.test/api/google/oauth/disconnect", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  expect(deactivate).toHaveBeenCalledWith("fictional-user", {
    revokeAccess: true,
    expectedConnection: {
      id: prepared.connectionId,
      updatedAt: prepared.updatedAt,
    },
  });
});
