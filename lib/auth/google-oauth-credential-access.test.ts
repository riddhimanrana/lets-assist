import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const owner = "c64b1000-0000-4000-8000-000000000001";
const other = "c64b1000-0000-4000-8000-000000000002";
const connectionId = "c64b1010-0000-4000-8000-000000000001";
let sessionUser: string | null;
let sessionError: boolean;
let bound: boolean;
let expires: string;
let revokeDuringRefresh: boolean;
let providerCalls: number;
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
        const result = () => {
          if (update) {
            writes.push({ table, filters: { ...filters }, data: update });
            return { data: { id: connectionId }, error: null };
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
              user_id: owner,
              provider: "google",
              access_token: "fictional-access-ciphertext",
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
          is: (key: string, value: unknown) => {
            filters[key] = value;
            return query;
          },
          update: (data: unknown) => {
            update = data;
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
const provider = mock(async (url: string | URL | Request) => {
  expect(String(url)).toBe("https://oauth2.googleapis.com/token");
  providerCalls++;
  if (revokeDuringRefresh) sessionUser = other;
  return Response.json({
    access_token: "fictional-refreshed",
    expires_in: 3600,
  });
});
globalThis.fetch = provider as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const {
  getGoogleOAuthConnectionForBinding,
  hasUnboundActiveGoogleOAuthConnection,
  hasOtherActiveGoogleOAuthConnection,
} = await import("./google-oauth-connection-store");
const { getValidAccessToken } = await import("@/services/calendar");
const {
  getGoogleAccessTokenForUser,
  deactivateGoogleConnection,
  markPersonalCalendarConnectionSynced,
} = await import("@/services/calendar-operations");
beforeEach(() => {
  sessionUser = owner;
  sessionError = false;
  bound = true;
  expires = "2020-01-01T00:00:00Z";
  revokeDuringRefresh = false;
  providerCalls = 0;
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
