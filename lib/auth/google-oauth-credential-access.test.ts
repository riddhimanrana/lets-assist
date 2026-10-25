import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const owner = "c64b1000-0000-4000-8000-000000000001";
const other = "c64b1000-0000-4000-8000-000000000002";
const connectionId = "c64b1010-0000-4000-8000-000000000001";
const updatedAt = "2026-10-07T00:00:00.000Z";
let sessionUser: string | null;
let sessionError: boolean;
let bound: boolean;
let expires: string;
let revokeDuringRefresh: boolean;
let disconnectDuringRefresh: boolean;
let replaceCredentialsDuringRefresh: boolean;
let currentAccessToken: string;
let writeFailure: "error" | "missing" | null;
let providerCalls: number;
let providerStatus: number;
let providerBody: unknown;
let providerFailure: Error | null;
const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{
  table: string;
  filters: Record<string, unknown>;
  data: unknown;
}> = [];
const order: string[] = [];
const binding = {
  purpose: "personal_calendar",
  organizationId: null,
  pluginKey: null,
} as const;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        order.push("authenticate");
        return {
          data: { user: sessionUser ? { id: sessionUser } : null },
          error: sessionError ? { message: "denied" } : null,
        };
      },
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    order.push("admin");
    return {
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        let update: unknown;
        let removed = false;
        const result = () => {
          if (update || removed) {
            writes.push({
              table,
              filters: { ...filters },
              data: removed ? "delete" : update,
            });
            return {
              data: writeFailure ? null : { id: connectionId },
              error:
                writeFailure === "error" ? { message: "write refused" } : null,
            };
          }
          reads.push({ table, filters: { ...filters } });
          if (table === "user_google_oauth_connection_bindings") {
            return {
              data: bound
                ? {
                    connection_id: connectionId,
                    identity_email: null,
                    identity_verified_at: null,
                  }
                : null,
              error: null,
            };
          }
          return {
            data: {
              id: connectionId,
              updated_at: updatedAt,
              user_id: owner,
              provider: "google",
              access_token: currentAccessToken,
              refresh_token: "fictional-refresh-ciphertext",
              calendar_email: "owner@local.test",
              token_expires_at: expires,
              is_active: true,
              connection_type: "calendar",
              granted_scopes:
                "https://www.googleapis.com/auth/calendar.app.created",
            },
            error: null,
          };
        };
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters[key] = value;
            return query;
          },
          neq: (key: string, value: unknown) => {
            filters[`not:${key}`] = value;
            return query;
          },
          is: (key: string, value: unknown) => {
            filters[key] = value;
            return query;
          },
          update: (data: unknown) => {
            update = data;
            return query;
          },
          delete: () => {
            removed = true;
            return query;
          },
          maybeSingle: async () => result(),
          then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
            Promise.resolve(result()).then(resolve),
        };
        return query;
      },
    };
  },
}));
mock.module("@/lib/encryption", () => ({
  decryptWithRotation: (value: string) => ({
    plaintext:
      value === "fictional-refresh-ciphertext"
        ? "fictional-refresh"
        : "fictional-access",
    reencrypted: null,
  }),
  decrypt: () => "fictional-refresh",
  encrypt: (value: string) => `encrypted:${value}`,
}));
const originalFetch = globalThis.fetch;
const provider = mock(
  async (url: string | URL | Request, init?: RequestInit) => {
    expect([
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/revoke",
    ]).toContain(String(url));
    providerCalls++;
    requests.push({ url: String(url), init });
    if (revokeDuringRefresh) sessionUser = other;
    if (disconnectDuringRefresh) bound = false;
    if (replaceCredentialsDuringRefresh)
      currentAccessToken = "fictional-reconnected-ciphertext";
    if (providerFailure) throw providerFailure;
    return Response.json(providerBody, { status: providerStatus });
  },
);
globalThis.fetch = provider as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const {
  getGoogleOAuthConnectionForBinding,
  hasUnboundActiveGoogleOAuthConnection,
  hasOtherActiveGoogleOAuthConnection,
} = await import("./google-oauth-connection-store");
const { getValidAccessToken, refreshAccessToken, isTokenExpired } =
  await import("@/services/calendar");
const {
  getGoogleAccessTokenForUser,
  deactivateGoogleConnection,
  markPersonalCalendarConnectionSynced,
  revokeGoogleCalendarAccess,
} = await import("@/services/calendar-operations");
beforeEach(() => {
  sessionUser = owner;
  sessionError = false;
  bound = true;
  expires = "2020-01-01T00:00:00Z";
  revokeDuringRefresh = false;
  disconnectDuringRefresh = false;
  replaceCredentialsDuringRefresh = false;
  currentAccessToken = "fictional-access-ciphertext";
  writeFailure = null;
  providerCalls = 0;
  providerStatus = 200;
  providerBody = { access_token: "fictional-refreshed", expires_in: 3600 };
  providerFailure = null;
  requests.length = 0;
  reads.length = 0;
  writes.length = 0;
  order.length = 0;
});

test.each([null, other])(
  "default credential calls refuse subject %s before privileged work",
  async (actor) => {
    sessionUser = actor;
    expect(await getGoogleOAuthConnectionForBinding(owner, binding)).toBeNull();
    expect(await getValidAccessToken(owner)).toBeNull();
    expect((await deactivateGoogleConnection(owner)).success).toBe(false);
    await markPersonalCalendarConnectionSynced(owner);
    expect(
      await getGoogleAccessTokenForUser(owner, false, {
        expectedBinding: {
          purpose: "organization_calendar",
          organizationId: other,
          pluginKey: null,
        },
      }),
    ).toBeNull();
    expect(await hasUnboundActiveGoogleOAuthConnection(owner)).toBe(false);
    expect(await hasOtherActiveGoogleOAuthConnection(owner, connectionId)).toBe(
      true,
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    expect(order.every((entry) => entry === "authenticate")).toBe(true);
    expect(providerCalls).toBe(0);
  },
);

test("an Auth error denies even a matching subject", async () => {
  sessionError = true;
  expect(await getGoogleOAuthConnectionForBinding(owner, binding)).toBeNull();
  expect(order).toEqual(["authenticate"]);
});

test("own-account read authenticates before resolving exact binding and credentials", async () => {
  expect((await getGoogleOAuthConnectionForBinding(owner, binding))?.id).toBe(
    connectionId,
  );
  expect(order).toEqual(["authenticate", "admin"]);
  expect(reads).toEqual([
    {
      table: "user_google_oauth_connection_bindings",
      filters: {
        user_id: owner,
        provider: "google",
        purpose: "personal_calendar",
        organization_id: null,
        plugin_key: null,
      },
    },
    {
      table: "user_calendar_connections",
      filters: {
        id: connectionId,
        user_id: owner,
        provider: "google",
        is_active: true,
      },
    },
  ]);
});

test("missing binding never falls back to an unbound credential", async () => {
  bound = false;
  expect(await getGoogleOAuthConnectionForBinding(owner, binding)).toBeNull();
  expect(reads.map((read) => read.table)).toEqual([
    "user_google_oauth_connection_bindings",
  ]);
});

test("explicit worker context preserves credential access without mutating session state", async () => {
  sessionUser = null;
  expect(
    (
      await getGoogleOAuthConnectionForBinding(owner, binding, {
        useServiceRole: true,
      })
    )?.id,
  ).toBe(connectionId);
  expect(order).toEqual(["admin"]);
  expect(reads[1].filters.user_id).toBe(owner);
});

test("personal refresh uses the service credential client after subject and binding checks", async () => {
  expect(await getValidAccessToken(owner)).toBe("fictional-refreshed");
  expect(providerCalls).toBe(1);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    table: "user_calendar_connections",
    filters: { id: connectionId, user_id: owner, provider: "google" },
    data: { access_token: "encrypted:fictional-refreshed" },
  });
});

test("server refresh preserves explicit service access and exact binding predicates", async () => {
  sessionUser = null;
  expect(
    await getGoogleAccessTokenForUser(owner, true, {
      expectedBinding: binding,
      connectionType: "calendar",
    }),
  ).toBe("fictional-refreshed");
  expect(providerCalls).toBe(1);
  expect(order.includes("authenticate")).toBe(false);
  expect(writes[0].filters).toEqual({
    id: connectionId,
    user_id: owner,
    provider: "google",
    is_active: true,
    access_token: "fictional-access-ciphertext",
    refresh_token: "fictional-refresh-ciphertext",
    token_expires_at: expires,
  });
});

test("a session subject change during refresh prevents persistence and token return", async () => {
  revokeDuringRefresh = true;
  expect(
    await getGoogleAccessTokenForUser(owner, false, {
      expectedBinding: binding,
      connectionType: "calendar",
    }),
  ).toBeNull();
  expect(providerCalls).toBe(1);
  expect(writes).toEqual([]);
});

test("personal refresh rechecks the current subject after the provider response", async () => {
  revokeDuringRefresh = true;
  expect(await getValidAccessToken(owner)).toBeNull();
  expect(providerCalls).toBe(1);
  expect(writes).toEqual([]);
});

test("personal refresh refuses a concurrently disconnected binding", async () => {
  disconnectDuringRefresh = true;
  expect(await getValidAccessToken(owner)).toBeNull();
  expect(providerCalls).toBe(1);
  expect(writes).toEqual([]);
});

test("a successful refresh cannot replace a reconnected grant on the same row", async () => {
  replaceCredentialsDuringRefresh = true;
  expect(await getValidAccessToken(owner)).toBeNull();
  expect(writes).toEqual([]);
});

test.each(["error", "missing"] as const)(
  "personal refresh requires confirmed persistence after %s result",
  async (failure) => {
    writeFailure = failure;
    expect(await getValidAccessToken(owner)).toBeNull();
    expect(providerCalls).toBe(1);
    expect(writes).toHaveLength(1);
  },
);

test.each([429, 500, 503])(
  "HTTP %s leaves a valid connection available for retry",
  async (status) => {
    providerStatus = status;
    providerBody = { error: "invalid_grant" };
    expect(await getValidAccessToken(owner)).toBeNull();
    expect(writes).toEqual([]);
  },
);

test.each(["invalid_client", "invalid_request"])(
  "%s does not revoke the user's grant",
  async (error) => {
    providerStatus = 400;
    providerBody = { error };
    expect(await getValidAccessToken(owner)).toBeNull();
    expect(writes).toEqual([]);
  },
);

test.each([
  new TypeError("fictional transport failure"),
  new DOMException("fictional timeout", "TimeoutError"),
])("transport failure %s preserves the connection", async (error) => {
  providerFailure = error;
  expect(await getValidAccessToken(owner)).toBeNull();
  expect(writes).toEqual([]);
});

test.each([
  null,
  {},
  { access_token: "", expires_in: 3600 },
  { access_token: "fictional-token", expires_in: "3600" },
  { access_token: "fictional-token", expires_in: 0 },
  { access_token: "fictional-token", expires_in: -1 },
  { access_token: "fictional-token", expires_in: 1.5 },
  { access_token: "fictional-token", expires_in: Number.MAX_SAFE_INTEGER },
])(
  "malformed token response %# cannot update or deactivate credentials",
  async (body) => {
    providerBody = body;
    expect(await getValidAccessToken(owner)).toBeNull();
    expect(writes).toEqual([]);
  },
);

test("an explicit invalid grant deactivates only the unchanged credential after revalidation", async () => {
  providerStatus = 400;
  providerBody = { error: "invalid_grant" };
  expect(await getValidAccessToken(owner)).toBeNull();
  expect(writes).toEqual([
    {
      table: "user_calendar_connections",
      filters: {
        id: connectionId,
        user_id: owner,
        provider: "google",
        is_active: true,
        access_token: "fictional-access-ciphertext",
        refresh_token: "fictional-refresh-ciphertext",
        token_expires_at: expires,
      },
      data: { is_active: false },
    },
  ]);
  expect(
    order.filter((step) => step === "authenticate").length,
  ).toBeGreaterThanOrEqual(3);
});

test.each(["subject", "binding"])(
  "an invalid grant cannot mutate credentials after %s changes",
  async (change) => {
    providerStatus = 400;
    providerBody = { error: "invalid_grant" };
    revokeDuringRefresh = change === "subject";
    disconnectDuringRefresh = change === "binding";
    expect(await getValidAccessToken(owner)).toBeNull();
    expect(writes).toEqual([]);
  },
);

test("refresh preserves its public contract and sends a bounded form request", async () => {
  expect(await refreshAccessToken("fictional-refresh")).toEqual({
    accessToken: "fictional-refreshed",
    expiresIn: 3600,
  });
  const request = requests[0];
  expect(request.url).toBe("https://oauth2.googleapis.com/token");
  expect(request.init).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
  });
  expect(request.init?.signal).toBeInstanceOf(AbortSignal);
  expect(
    new URLSearchParams(String(request.init?.body)).get("refresh_token"),
  ).toBe("fictional-refresh");
  expect(
    new URLSearchParams(String(request.init?.body)).get("grant_type"),
  ).toBe("refresh_token");
});

test("revocation keeps the token out of URLs and refuses transport failures", async () => {
  expect(await revokeGoogleCalendarAccess("fictional-refresh&+token")).toBe(
    true,
  );
  expect(requests[0].url).toBe("https://oauth2.googleapis.com/revoke");
  expect(requests[0].init).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal);
  expect(new URLSearchParams(String(requests[0].init?.body)).get("token")).toBe(
    "fictional-refresh&+token",
  );
  providerFailure = new TypeError("fictional network failure");
  expect(await revokeGoogleCalendarAccess("fictional-refresh")).toBe(false);
});

test("invalid stored expiry never treats a token as fresh", () => {
  expect(isTokenExpired("not-a-date")).toBe(true);
});

test("disconnect acknowledges only deletion of the unchanged credential", async () => {
  expect(await deactivateGoogleConnection(owner)).toEqual({
    success: true,
    remoteRevocation: "revoked",
    localCleanup: "removed",
  });
  expect(requests[0].url).toBe("https://oauth2.googleapis.com/revoke");
  expect(writes).toEqual([
    {
      table: "user_calendar_connections",
      filters: {
        id: connectionId,
        user_id: owner,
        provider: "google",
        is_active: true,
        access_token: "fictional-access-ciphertext",
        refresh_token: "fictional-refresh-ciphertext",
        token_expires_at: expires,
        updated_at: updatedAt,
      },
      data: "delete",
    },
  ]);
});

test("a reconnect after disconnect preparation is refused before provider revocation", async () => {
  expect(
    await deactivateGoogleConnection(owner, {
      expectedConnection: {
        id: connectionId,
        updatedAt: "2026-10-06T00:00:00.000Z",
      },
    }),
  ).toMatchObject({
    success: false,
    remoteRevocation: "not_requested",
    localCleanup: "failed",
  });
  expect(providerCalls).toBe(0);
  expect(writes).toEqual([]);
});

test.each(["subject", "binding", "credentials"])(
  "disconnect preserves a concurrent %s change after provider revocation",
  async (change) => {
    revokeDuringRefresh = change === "subject";
    disconnectDuringRefresh = change === "binding";
    replaceCredentialsDuringRefresh = change === "credentials";
    expect(await deactivateGoogleConnection(owner)).toMatchObject({
      success: false,
      remoteRevocation: "revoked",
      localCleanup: "failed",
    });
    expect(writes).toEqual([]);
  },
);

test.each(["error", "missing"] as const)(
  "disconnect reports incomplete cleanup when guarded deletion returns %s",
  async (failure) => {
    writeFailure = failure;
    expect(await deactivateGoogleConnection(owner)).toMatchObject({
      success: false,
      remoteRevocation: "revoked",
      localCleanup: "failed",
    });
    expect(writes).toHaveLength(1);
  },
);
