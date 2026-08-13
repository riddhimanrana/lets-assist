import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type Role = "admin" | "staff" | "member";
type Row = Record<string, unknown>;

let membership: Row = {
  organization_id: "org-1",
  user_id: "user-1",
  role: "admin",
  status: "inactive",
};
let behaviorCalls = 0;
let surfaceCalls = 0;

class Query {
  private filters: Array<[string, unknown]> = [];

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  async maybeSingle() {
    const matches = this.filters.every(
      ([column, value]) => membership[column] === value,
    );
    return { data: matches ? membership : null, error: null };
  }
}

const client = {
  from(table: string) {
    if (table !== "organization_members") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return new Query();
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => client,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/plugins/organization-plugin-access", () => ({
  isEntitlementActive: () => true,
  loadAccessibleOrganizationPluginAccess: async () => [
    {
      organization_id: "org-1",
      plugin_key: "private-plugin",
      enabled: true,
      configuration: {},
      installed_at: "2026-08-01T00:00:00.000Z",
      installed_version: "1.0.0",
      latest_version: "1.0.0",
      force_update_version: null,
    },
  ],
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => ({
    manifest: {
      key: "private-plugin",
      name: "Private Plugin",
      description: "Private",
      navLabel: "Private",
      version: "1.0.0",
      visibility: "private",
      minimumRole: "member",
      surfaceAccess: { "organization.overview.cards": "member" },
      behaviorAccess: { "organization.tabs": "member" },
    },
    renderSurface: async () => {
      surfaceCalls += 1;
      return "private surface";
    },
    resolveBehaviorHook: async () => {
      behaviorCalls += 1;
      return [];
    },
  }),
}));

const { resolveOrganizationPlugins } = await import("./resolve-org-plugins");
const { resolveOrganizationPluginSurfaces } =
  await import("./resolve-plugin-surfaces");
const { resolveOrganizationPluginBehaviorHook } =
  await import("./resolve-plugin-behaviors");

beforeEach(() => {
  behaviorCalls = 0;
  surfaceCalls = 0;
});

describe("inactive organization membership plugin host denial", () => {
  for (const role of ["admin", "staff", "member"] as const) {
    test(`does not resolve private plugin access from a stale ${role} role`, async () => {
      membership = {
        organization_id: "org-1",
        user_id: "user-1",
        role,
        status: "inactive",
      };

      const plugins = await resolveOrganizationPlugins({
        organizationId: "org-1",
        userRole: role,
        viewerUserId: "user-1",
      } as {
        organizationId: string;
        userRole: Role;
        viewerUserId: string;
      });

      expect(plugins).toEqual([]);
    });

    test(`does not invoke private behavior hooks from a stale ${role} role`, async () => {
      membership = {
        organization_id: "org-1",
        user_id: "user-1",
        role,
        status: "inactive",
      };

      const contributions = await resolveOrganizationPluginBehaviorHook({
        organizationId: "org-1",
        hook: "organization.tabs",
        viewerRole: role,
        viewerUserId: "user-1",
        useAdminClient: true,
      } as Parameters<typeof resolveOrganizationPluginBehaviorHook>[0] & {
        viewerUserId: string;
      });

      expect(contributions).toEqual([]);
      expect(behaviorCalls).toBe(0);
    });

    test(`does not invoke private surfaces from a stale ${role} role`, async () => {
      membership = {
        organization_id: "org-1",
        user_id: "user-1",
        role,
        status: "inactive",
      };

      const surfaces = await resolveOrganizationPluginSurfaces({
        organizationId: "org-1",
        surface: "organization.overview.cards",
        viewerRole: role,
        viewerUserId: "user-1",
        useAdminClient: true,
      } as Parameters<typeof resolveOrganizationPluginSurfaces>[0] & {
        viewerUserId: string;
      });

      expect(surfaces).toEqual([]);
      expect(surfaceCalls).toBe(0);
    });
  }
});
