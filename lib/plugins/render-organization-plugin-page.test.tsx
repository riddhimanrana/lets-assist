import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let renderCalls = 0;

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

  async maybeSingle() {
    const row =
      this.table === "organizations"
        ? { id: "org-1", name: "Test Organization", username: "test-org" }
        : {
            organization_id: "org-1",
            user_id: "user-1",
            role: "admin",
            status: "inactive",
          };
    const matches = this.filters.every(
      ([column, value]) => row[column as keyof typeof row] === value,
    );
    return { data: matches ? row : null, error: null };
  }
}

const client = {
  from(table: string) {
    return new Query(table);
  },
};

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => client,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: "user-1" } }),
}));
mock.module("@/lib/plugins/organization-plugin-context", () => ({
  readOrganizationPluginContext: async (
    _label: string,
    load: () => Promise<{ data: unknown }>,
  ) => (await load()).data,
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => ({
    manifest: {
      key: "private-plugin",
      name: "Private Plugin",
      version: "1.0.0",
      visibility: "private",
      minimumRole: "member",
    },
    renderOrganizationPage: async () => {
      renderCalls += 1;
      return "private page";
    },
  }),
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPluginByKey: async () => ({
    key: "private-plugin",
    name: "Private Plugin",
    description: "Private",
    configuration: {},
  }),
}));

const { renderOrganizationPluginPage } =
  await import("./render-organization-plugin-page");

beforeEach(() => {
  renderCalls = 0;
});

describe("direct organization plugin page membership status", () => {
  test("an inactive stale admin role never reaches the private plugin renderer", async () => {
    await expect(
      renderOrganizationPluginPage({
        organizationIdentifier: "test-org",
        pluginKey: "private-plugin",
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(renderCalls).toBe(0);
  });
});
