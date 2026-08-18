import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { OrganizationPluginDefinition } from "@/types";

mock.module("server-only", () => ({}));

let installedVersion = "0.1.0";

const definition = {
  manifest: {
    key: "dvhs-csf",
    name: "DVHS CSF",
    description: "Private CSF workflows",
    navLabel: "CSF",
    version: "1.0.0",
    visibility: "private",
    minimumRole: "member",
    organizationExperience: {
      publicPage: "plugin",
      publicRoute: "public",
      members: "hidden",
      projects: "hidden",
      profileMembership: "hidden",
      joinMode: "plugin",
    },
  },
} satisfies OrganizationPluginDefinition;

function accessRow() {
  return {
    organization_id: "org-1",
    plugin_key: "dvhs-csf",
    enabled: true,
    configuration: {},
    installed_at: "2026-08-17T00:00:00.000Z",
    installed_version: installedVersion,
    latest_version: "1.0.0",
    force_update_version: null,
    is_accessible: true,
    entitlement_is_forced: false,
  };
}

class Query {
  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle() {
    if (this.table === "organization_members") {
      return {
        data: { role: "admin", status: "active" },
        error: null,
      };
    }
    if (this.table === "organization_plugin_installs") {
      return {
        data: { enabled: true, installed_version: installedVersion },
        error: null,
      };
    }
    if (this.table === "organization_plugin_access") {
      return { data: accessRow(), error: null };
    }
    throw new Error(`Unexpected table: ${this.table}`);
  }
}

const client = {
  from(table: string) {
    return new Query(table);
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => client,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: (key: string) =>
    key === definition.manifest.key ? definition : undefined,
}));
mock.module("@/lib/plugins/organization-plugin-access", () => ({
  isEntitlementActive: () => true,
  loadAccessibleOrganizationPluginAccess: async () => [accessRow()],
}));

const { resolveOrganizationPluginExperiences, resolveOrganizationPlugins } =
  await import("./resolve-org-plugins");
const { hasOrganizationPluginRuntimeAccess } = await import("./runtime-access");

beforeEach(() => {
  installedVersion = "0.1.0";
});

describe("plugin runtime version gate", () => {
  test("a pinned older install cannot execute the loaded 1.0 runtime", async () => {
    expect(
      await hasOrganizationPluginRuntimeAccess({
        organizationId: "org-1",
        pluginKey: "dvhs-csf",
      }),
    ).toBe(false);
    expect(
      await resolveOrganizationPlugins({
        organizationId: "org-1",
        userRole: "admin",
        viewerUserId: "user-1",
      }),
    ).toEqual([]);
    expect(await resolveOrganizationPluginExperiences(["org-1"])).toEqual([]);
  });

  test("the ordinary version transition unlocks the exact loaded runtime", async () => {
    installedVersion = "1.0.0";

    expect(
      await hasOrganizationPluginRuntimeAccess({
        organizationId: "org-1",
        pluginKey: "dvhs-csf",
      }),
    ).toBe(true);
    expect(
      await resolveOrganizationPlugins({
        organizationId: "org-1",
        userRole: "admin",
        viewerUserId: "user-1",
      }),
    ).toMatchObject([{ key: "dvhs-csf", installedVersion: "1.0.0" }]);
    expect(await resolveOrganizationPluginExperiences(["org-1"])).toEqual([
      {
        organizationId: "org-1",
        pluginKey: "dvhs-csf",
        experience: definition.manifest.organizationExperience!,
      },
    ]);
  });
});
