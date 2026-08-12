import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const ORGANIZATION_ID = "b1000000-0000-4000-8000-000000000001";
const ACTOR_ID = "b2000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "b3000000-0000-4000-8000-000000000001";

let authResult: {
  user: { id: string } | null;
  error: { message: string } | null;
  requiresMfa?: boolean;
};
const authOptions: unknown[] = [];
const deletionCalls: Record<string, unknown>[] = [];
const revalidatedPaths: string[] = [];

mock.module("next/cache", () => ({
  revalidatePath: (path: string) => revalidatedPaths.push(path),
}));

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: unknown) => {
    authOptions.push(options);
    return authResult;
  },
}));

class Query {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() {
    const rows: Record<string, unknown>[] =
      this.table === "plugins"
        ? [
            {
              key: "test-plugin",
              name: "Test Plugin",
              visibility: "global",
              is_active: true,
            },
          ]
        : this.table === "organizations"
          ? [
              {
                id: ORGANIZATION_ID,
                name: "Test Organization",
                username: "test-organization",
              },
            ]
          : [];
    return Promise.resolve({
      data:
        rows.find((row) =>
          this.filters.every(([column, value]) => row[column] === value),
        ) ?? null,
      error: null,
    });
  }
}

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => new Query(table),
  }),
}));

mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => ({
    manifest: {
      key: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      visibility: "global",
    },
    lifecycle: { onDataDelete: async () => undefined },
  }),
}));

mock.module("@/lib/plugins/plugin-data-deletion-readiness", () => ({
  getPluginDataDeletionReadiness: () => ({
    ready: true,
    blockers: [],
  }),
}));

mock.module("@/lib/plugins/plugin-data-deletion", () => ({
  runPermanentPluginDataDeletion: async (input: Record<string, unknown>) => {
    deletionCalls.push(input);
    return { success: true };
  },
}));

mock.module("./plugin-shared", () => ({
  isMissingPluginTableError: () => false,
  isOrganizationAdminForSettings: async () => true,
}));

const { permanentlyDeleteOrganizationPluginData } =
  await import("./plugin-data-deletion-mutation");

function options() {
  return {
    organizationId: ORGANIZATION_ID,
    pluginKey: "test-plugin",
    confirmationText: `Test Organization/${ORGANIZATION_ID}/test-plugin`,
    requestKey: REQUEST_KEY,
  };
}

beforeEach(() => {
  authResult = { user: { id: ACTOR_ID }, error: null };
  authOptions.length = 0;
  deletionCalls.length = 0;
  revalidatedPaths.length = 0;
});

describe("permanentlyDeleteOrganizationPluginData", () => {
  test("requires fresh, MFA-aware authentication before invoking the destructive service", async () => {
    authResult = { user: null, error: null };
    let result = await permanentlyDeleteOrganizationPluginData(options());
    expect(result.success).toBe(false);
    expect(deletionCalls).toEqual([]);

    authResult = { user: null, error: null, requiresMfa: true };
    result = await permanentlyDeleteOrganizationPluginData(options());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/two-factor authentication/i);
    expect(deletionCalls).toEqual([]);

    expect(authOptions).toEqual([
      { sensitive: true, checkMfa: true },
      { sensitive: true, checkMfa: true },
    ]);
  });

  test("passes only server-derived actor identity and the exact confirmed scope to the service", async () => {
    const result = await permanentlyDeleteOrganizationPluginData(options());

    expect(result.success).toBe(true);
    expect(deletionCalls).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        pluginKey: "test-plugin",
        actor: { id: ACTOR_ID, type: "user" },
        organizationRole: "admin",
        confirmationText: `Test Organization/${ORGANIZATION_ID}/test-plugin`,
        requestKey: REQUEST_KEY,
      },
    ]);
  });

  test("fails closed on fresh-auth lookup errors", async () => {
    authResult = {
      user: null,
      error: { message: "auth service unavailable" },
    };

    const result = await permanentlyDeleteOrganizationPluginData(options());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/verify your authentication/i);
    expect(deletionCalls).toEqual([]);
  });
});
