import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const connectionId = "20000000-0000-4000-8000-000000000001";
const updatedAt = "2026-10-07T08:00:00.123456+00:00";
let sessionUser: string | null = owner;
let authError: unknown = null;
let connection: Record<string, unknown> | null = null;
let rpcData: unknown;
let rpcError: { code: string; message: string } | null = null;
let transportFailure: Error | null = null;
const getUser = mock(async () => ({
  data: { user: sessionUser ? { id: sessionUser } : null },
  error: authError,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
const boundConnection = mock(
  async (_user: string, _binding: unknown, _options: unknown) => connection,
);
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: boundConnection,
}));
const binding = {
  purpose: "personal_calendar",
  organizationId: null,
  pluginKey: null,
};
mock.module("@/services/calendar", () => ({
  PERSONAL_CALENDAR_GOOGLE_BINDING: binding,
}));
const abortSignal = mock(async (_signal: AbortSignal) => {
  if (transportFailure) throw transportFailure;
  return { data: rpcData, error: rpcError };
});
const rpc = mock((_name: string, _args: unknown) => ({ abortSignal }));
const admin = mock(() => ({ rpc }));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: admin }));
const originalFetch = globalThis.fetch;
const provider = mock(async () => {
  throw new Error("Unexpected provider request");
});
globalThis.fetch = provider as unknown as typeof fetch;

const { preparePersonalCalendarDisconnect } = await import("./disconnect");

beforeEach(() => {
  sessionUser = owner;
  authError = null;
  connection = {
    id: connectionId,
    user_id: owner,
    provider: "google",
    updated_at: updatedAt,
  };
  rpcData = {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: 1,
  };
  rpcError = null;
  transportFailure = null;
  for (const fn of [
    getUser,
    boundConnection,
    rpc,
    abortSignal,
    admin,
    provider,
  ])
    fn.mockClear();
});
afterEach(() => expect(provider).not.toHaveBeenCalled());
afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test.each([0, 1, 2000])(
  "prepares %d cleanup entries with one exact-bound RPC and no provider operation",
  async (count) => {
    rpcData = {
      user_id: owner,
      connection_id: connectionId,
      connection_updated_at: updatedAt,
      prepared_count: count,
    };
    expect(await preparePersonalCalendarDisconnect(owner)).toEqual({
      connectionId,
      updatedAt,
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(boundConnection).toHaveBeenCalledWith(owner, binding, {
      activeOnly: false,
    });
    expect(rpc.mock.calls).toEqual([
      [
        "prepare_personal_calendar_disconnect",
        {
          p_actor_user_id: owner,
          p_connection_id: connectionId,
          p_expected_updated_at: updatedAt,
        },
      ],
    ]);
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(abortSignal.mock.calls[0][0].aborted).toBe(false);
  },
);

test("an unauthenticated request performs no privileged lookup or write", async () => {
  sessionUser = null;
  await expect(preparePersonalCalendarDisconnect(owner)).rejects.toMatchObject({
    status: 401,
  });
  expect(boundConnection).not.toHaveBeenCalled();
  expect(admin).not.toHaveBeenCalled();
});
test("another account cannot prepare the target's cleanup", async () => {
  sessionUser = other;
  await expect(preparePersonalCalendarDisconnect(owner)).rejects.toMatchObject({
    status: 403,
  });
  expect(boundConnection).not.toHaveBeenCalled();
  expect(admin).not.toHaveBeenCalled();
});
test("an Auth lookup error fails before privileged access", async () => {
  authError = new Error("private-provider-diagnostic");
  await expect(preparePersonalCalendarDisconnect(owner)).rejects.toMatchObject({
    status: 503,
  });
  expect(boundConnection).not.toHaveBeenCalled();
  expect(admin).not.toHaveBeenCalled();
});
test.each([
  { id: "invalid", user_id: owner, provider: "google" },
  { id: connectionId, user_id: other, provider: "google" },
  { id: connectionId, user_id: owner, provider: "other" },
  {
    id: connectionId,
    user_id: owner,
    provider: "google",
    updated_at: "invalid",
  },
])(
  "a missing or invalid exact binding cannot write cleanup metadata: %j",
  async (value) => {
    connection = value;
    await expect(
      preparePersonalCalendarDisconnect(owner),
    ).rejects.toMatchObject({ status: 503 });
    expect(admin).not.toHaveBeenCalled();
  },
);
test.each([
  ["42501", 403],
  ["55P03", 409],
  ["55000", 409],
  ["54000", 409],
  ["22023", 503],
  ["XX000", 503],
] as const)(
  "database refusal %s preserves a safe %d result",
  async (code, status) => {
    rpcError = { code, message: "private-provider-diagnostic" };
    const error = await preparePersonalCalendarDisconnect(owner).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ status });
    expect((error as Error).message).not.toContain(
      "private-provider-diagnostic",
    );
    if (code === "54000") {
      expect((error as Error).message).toContain("Contact support");
      expect((error as Error).message).not.toContain("Retry");
    }
    expect(rpc).toHaveBeenCalledTimes(1);
  },
);
test.each([
  null,
  {
    user_id: other,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: 1,
  },
  { user_id: owner, connection_id: other, prepared_count: 1 },
  {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: -1,
  },
  {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: 2001,
  },
  {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: 0.5,
  },
  {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: "1",
  },
  {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: updatedAt,
    prepared_count: 1,
    access_token: "private",
  },
])(
  "invalid or unacknowledged persistence refuses disconnect: %j",
  async (value) => {
    rpcData = value;
    await expect(
      preparePersonalCalendarDisconnect(owner),
    ).rejects.toMatchObject({ status: 503 });
    expect(rpc).toHaveBeenCalledTimes(1);
  },
);
test("an aborted transport never becomes successful preparation or exposes provider details", async () => {
  transportFailure = new Error("private-provider-diagnostic");
  transportFailure.name = "AbortError";
  const error = await preparePersonalCalendarDisconnect(owner).catch(
    (value: unknown) => value,
  );
  expect(error).toMatchObject({ status: 503 });
  expect((error as Error).message).not.toContain("private-provider-diagnostic");
  expect(rpc).toHaveBeenCalledTimes(1);
});

test("an absent or unconfirmed connection refuses before the preparation RPC", async () => {
  connection = null;
  await expect(preparePersonalCalendarDisconnect(owner)).rejects.toMatchObject({
    status: 404,
  });
  expect(admin).not.toHaveBeenCalled();
});
test("a newer credential acknowledgement cannot authorize deletion of the initial connection", async () => {
  rpcData = {
    user_id: owner,
    connection_id: connectionId,
    connection_updated_at: "2026-10-07T08:00:00.123457+00:00",
    prepared_count: 1,
  };
  await expect(preparePersonalCalendarDisconnect(owner)).rejects.toMatchObject({
    status: 503,
  });
});

test.each(["2026-10-07T08:00:00.123456Z", "2026-10-07T01:00:00.123456-07:00"])(
  "accepts the same microsecond timestamp with provider offset spelling %s",
  async (stamp) => {
    rpcData = {
      user_id: owner,
      connection_id: connectionId,
      connection_updated_at: stamp,
      prepared_count: 0,
    };
    expect(await preparePersonalCalendarDisconnect(owner)).toEqual({
      connectionId,
      updatedAt,
    });
  },
);
