import { afterAll, beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let actor: string | null = "owner";
let visibility = "private";
let memberships: {
  user_id: string;
  organization_id: string;
  role: string;
  status: string;
}[] = [];
const profile = () => ({
  id: "owner",
  username: "alex",
  full_name: "Alex",
  profile_visibility: visibility,
});
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({
    user: actor ? { id: actor } : null,
    error: null,
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      let data: Record<string, unknown>[] =
        table === "profiles"
          ? [profile()]
          : table === "public_profile_read_model"
            ? visibility === "public"
              ? [profile()]
              : []
            : memberships;
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          data = data.filter((r) => r[key] === value);
          return q;
        },
        in: (key: string, values: unknown[]) => {
          data = data.filter((r) => values.includes(r[key]));
          return q;
        },
        limit: (count: number) => {
          data = data.slice(0, count);
          return q;
        },
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return q;
    },
  }),
}));
const { getVisibleProfileByUsername, getOrganizationMemberProfiles } =
  await import("./visible");
beforeEach(() => {
  actor = "owner";
  visibility = "private";
  memberships = [];
});
afterAll(() => mock.restore());
test("owner sees a private profile but strangers do not", async () => {
  expect((await getVisibleProfileByUsername("alex")).data?.id).toBe("owner");
  actor = "stranger";
  expect((await getVisibleProfileByUsername("alex")).data).toBeNull();
  actor = null;
  expect((await getVisibleProfileByUsername("alex")).data).toBeNull();
});
test("only an active shared-organization admin sees private profiles", async () => {
  actor = "viewer";
  memberships = [
    {
      user_id: "owner",
      organization_id: "org",
      role: "member",
      status: "active",
    },
    {
      user_id: "viewer",
      organization_id: "other",
      role: "admin",
      status: "active",
    },
  ];
  expect((await getVisibleProfileByUsername("alex")).data).toBeNull();
  memberships[1].organization_id = "org";
  expect((await getVisibleProfileByUsername("alex")).data?.id).toBe("owner");
  memberships[1].status = "inactive";
  expect((await getVisibleProfileByUsername("alex")).data).toBeNull();
});
test("organization-only profiles allow active peers, private profiles do not", async () => {
  actor = "viewer";
  memberships = [
    {
      user_id: "owner",
      organization_id: "org",
      role: "member",
      status: "active",
    },
    {
      user_id: "viewer",
      organization_id: "org",
      role: "member",
      status: "active",
    },
  ];
  expect((await getVisibleProfileByUsername("alex")).data).toBeNull();
  visibility = "organization_only";
  expect((await getVisibleProfileByUsername("alex")).data?.id).toBe("owner");
});
test("directory identity reads reject a different organization", async () => {
  actor = "viewer";
  memberships = [
    {
      user_id: "owner",
      organization_id: "org",
      role: "member",
      status: "active",
    },
    {
      user_id: "viewer",
      organization_id: "org",
      role: "admin",
      status: "active",
    },
  ];
  expect(
    (await getOrganizationMemberProfiles("org", ["owner"])).data?.length,
  ).toBe(1);
  expect(
    (await getOrganizationMemberProfiles("other", ["owner"])).data?.length,
  ).toBe(0);
});
