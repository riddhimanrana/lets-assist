import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let membershipStatus = "active";
let lifecycleCalls = 0;
let installWrites = 0;

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

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    if (this.table === "organizations") {
      return {
        data: {
          id: "org-1",
          name: "Test Organization",
          username: "test-org",
          description: null,
          logo_url: null,
          type: "school",
          verified: true,
          allowed_email_domains: null,
          show_members_publicly: false,
        },
        error: null,
      };
    }
    if (this.table === "organization_plugin_installs") {
      return { data: null, error: null };
    }
    if (this.table === "organization_members") {
      const row = {
        organization_id: "org-1",
        user_id: "actor-1",
        role: "admin",
        status: membershipStatus,
      };
      const matches = this.filters.every(
        ([column, value]) => row[column as keyof typeof row] === value,
      );
      return { data: matches ? row : null, error: null };
    }
    throw new Error(`Unexpected maybeSingle table: ${this.table}`);
  }

  async insert() {
    if (this.table !== "organization_plugin_installs") {
      throw new Error(`Unexpected insert table: ${this.table}`);
    }
    installWrites += 1;
    return { error: null };
  }
}

const adminClient = {
  from(table: string) {
    return new Query(table);
  },
  async rpc(name: string) {
    if (name === "acquire_plugin_control_plane_transition_lock") {
      // The action-level authorization result was valid, but access is revoked
      // while the consequential transition is acquiring its lease.
      membershipStatus = "inactive";
      return { data: true, error: null };
    }
    if (
      name === "refresh_plugin_control_plane_transition_lock" ||
      name === "release_plugin_control_plane_transition_lock"
    ) {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));
mock.module("@/lib/plugins/audit", () => ({
  logPluginAudit: async () => null,
  withPluginExecution: async (
    _organizationId: string,
    _pluginKey: string,
    _executionType: string,
    run: () => Promise<unknown>,
  ) => run(),
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => ({
    manifest: {
      key: "private-plugin",
      name: "Private Plugin",
      version: "1.0.0",
      visibility: "private",
    },
    lifecycle: {
      onInstall: async () => {
        lifecycleCalls += 1;
      },
    },
  }),
}));

const { transitionOrganizationPluginInstall } =
  await import("./control-plane-transition");

beforeEach(() => {
  membershipStatus = "active";
  lifecycleCalls = 0;
  installWrites = 0;
});

describe("plugin control-plane active admin revalidation", () => {
  test("revocation after an earlier admin result prevents lifecycle and install writes", async () => {
    const result = await transitionOrganizationPluginInstall({
      organizationId: "org-1",
      pluginKey: "private-plugin",
      actor: { id: "actor-1", type: "user" },
      organizationRole: "admin",
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/current.*organization admin/i);
    expect(lifecycleCalls).toBe(0);
    expect(installWrites).toBe(0);
  });
});
