import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

class Query {
  private filters: Array<[string, unknown]> = [];

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  async single() {
    const row = {
      organization_id: "org-1",
      user_id: "admin-1",
      role: "admin",
      status: "inactive",
    };
    const matches = this.filters.every(
      ([column, value]) => row[column as keyof typeof row] === value,
    );
    return { data: matches ? row : null, error: null };
  }

  async maybeSingle() {
    return this.single();
  }
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => new Query(),
  }),
}));

const { isOrganizationAdminForSettings } = await import("./plugin-shared");

describe("organization plugin settings authorization", () => {
  test("an inactive admin membership is not administrative authority", async () => {
    expect(await isOrganizationAdminForSettings("org-1", "admin-1")).toBe(
      false,
    );
  });
});
