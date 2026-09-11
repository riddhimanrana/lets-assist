import { beforeEach, expect, mock, test } from "bun:test";
let status: string | null = "active";
let readError = false;
let joinStatus = "already_member";
const filters: Record<string, unknown> = {};
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "fictional-user" } } }),
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async () => ({
      data: [
        {
          organization_id: "fictional-org",
          organization_username: "fictional-csf",
          join_status: joinStatus,
        },
      ],
      error: null,
    }),
    from: (table: string) => {
      expect(table).toBe("organization_members");
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return q;
        },
        maybeSingle: async () => ({
          data: status ? { status } : null,
          error: readError ? { message: "unavailable" } : null,
        }),
      };
      return q;
    },
  }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
const { joinOrganization } = await import("./actions");
const { joinedOrganizationPath } = await import("./join/join-result");
beforeEach(() => {
  status = "active";
  readError = false;
  joinStatus = "already_member";
});
test("active returning members receive their scoped organization destination", async () => {
  expect(joinedOrganizationPath(await joinOrganization("654321"))).toBe(
    "/organization/fictional-csf",
  );
  expect(filters).toEqual({
    organization_id: "fictional-org",
    user_id: "fictional-user",
  });
});
test("pending and inactive memberships remain restricted on invite reentry", async () => {
  for (const value of ["pending", "inactive", "suspended"]) {
    status = value;
    const result = await joinOrganization("654321");
    expect(result.error).toContain("Contact an organization administrator");
    expect(joinedOrganizationPath(result)).toBeNull();
    expect(status).toBe(value);
  }
});
test("missing membership and failed reads never create a successful destination", async () => {
  status = null;
  expect(joinedOrganizationPath(await joinOrganization("654321"))).toBeNull();
  status = "active";
  readError = true;
  expect(joinedOrganizationPath(await joinOrganization("654321"))).toBeNull();
});
test("a joined result still requires current active membership", async () => {
  joinStatus = "joined";
  status = "inactive";
  expect(joinedOrganizationPath(await joinOrganization("654321"))).toBeNull();
  status = "active";
  expect(joinedOrganizationPath(await joinOrganization("654321"))).toBe(
    "/organization/fictional-csf",
  );
});
