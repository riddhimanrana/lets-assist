import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * `updateOrganization`/`checkUsernameAvailability` are the only Server
 * Actions that update `organizations.username`. RLS ("Allow admins to
 * update organizations") also lets an org admin update the row directly
 * through the Data API with no column-level `WITH CHECK` on username, so
 * the database constraint in
 * `20260811190000_organization_username_reserved_slugs.sql` (proven in
 * `organization_username_reserved_slugs.test.sql`) is the real backstop --
 * but the Server Action must still refuse a rename onto a reserved
 * username itself, with a truthful "reserved" error, and must not block an
 * unrelated edit that leaves the username unchanged (so a legitimate
 * existing organization is never forced into a destructive rename here).
 */

type Claims = { sub: string } | null;

let claims: Claims = { sub: "admin-1" };
let isOrgAdmin = true;
let currentOrgRow: {
  username: string;
  logo_url: string | null;
  verified: boolean;
  auto_join_domain: string | null;
} | null = {
  username: "acme-nonprofit",
  logo_url: null,
  verified: false,
  auto_join_domain: null,
};
let updateError: { message?: string } | null = null;
let updateCalled = false;
let appliedUpdate: Record<string, unknown> | null = null;
let existingUsernames = new Set<string>();

function serverClient() {
  return {
    auth: {
      getClaims: async () => ({
        data: claims ? { claims: { sub: claims.sub } } : null,
        error: null,
      }),
    },
    from(table: string) {
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: isOrgAdmin ? { role: "admin" } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => ({
                data: existingUsernames.has(value)
                  ? { username: value }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`serverClient: unexpected table ${table}`);
    },
  };
}

function adminClient() {
  return {
    from(table: string) {
      if (table !== "organizations") {
        throw new Error(`adminClient: unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: currentOrgRow, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updateCalled = true;
            appliedUpdate = patch;
            return { error: updateError };
          },
        }),
      };
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient(),
}));

const { updateOrganization, checkUsernameAvailability } = await import(
  "./profile"
);

const baseUpdateData = {
  id: "org-1",
  name: "Acme Nonprofit",
  description: "Updated description",
  website: "",
  type: "nonprofit" as const,
  logoUrl: undefined,
};

beforeEach(() => {
  claims = { sub: "admin-1" };
  isOrgAdmin = true;
  currentOrgRow = {
    username: "acme-nonprofit",
    logo_url: null,
    verified: false,
    auto_join_domain: null,
  };
  updateError = null;
  updateCalled = false;
  appliedUpdate = null;
  existingUsernames = new Set();
});

describe("checkUsernameAvailability", () => {
  test("reports every reserved slug spelling as unavailable", async () => {
    for (const value of ["create", "CREATE", " join ", "Join"]) {
      expect(await checkUsernameAvailability(value)).toBe(false);
    }
  });

  test("reports an available, non-reserved username as available", async () => {
    expect(await checkUsernameAvailability("new-org-name")).toBe(true);
  });
});

describe("updateOrganization reserved-slug enforcement", () => {
  test("refuses a rename onto the reserved username 'create' with a truthful error", async () => {
    const result = await updateOrganization({
      ...baseUpdateData,
      username: "create",
    });

    expect(result).toEqual({
      error: "That username is reserved and can't be used",
    });
    expect(updateCalled).toBe(false);
  });

  test("refuses a case/whitespace variant of a reserved username", async () => {
    const result = await updateOrganization({
      ...baseUpdateData,
      username: "  JOIN  ",
    });

    expect(result).toEqual({
      error: "That username is reserved and can't be used",
    });
    expect(updateCalled).toBe(false);
  });

  test("an ordinary rename to a new, available username is accepted and persisted", async () => {
    const result = await updateOrganization({
      ...baseUpdateData,
      username: "acme-renamed",
    });

    expect(result).toEqual({ success: true });
    expect(updateCalled).toBe(true);
    expect(appliedUpdate?.username).toBe("acme-renamed");
  });

  test("saving unrelated fields without changing the username is unaffected by the reserved check", async () => {
    // Preserving a legitimate existing organization: the reserved-slug gate
    // must only fire on an actual rename, never on an ordinary edit that
    // happens to leave a pre-existing username in place.
    const result = await updateOrganization({
      ...baseUpdateData,
      username: currentOrgRow!.username,
      name: "Acme Nonprofit (Updated)",
    });

    expect(result).toEqual({ success: true });
    expect(updateCalled).toBe(true);
    expect(appliedUpdate?.username).toBe("acme-nonprofit");
  });

  test("a non-admin caller is rejected before the reserved-slug check runs", async () => {
    isOrgAdmin = false;
    const result = await updateOrganization({
      ...baseUpdateData,
      username: "create",
    });
    expect(result).toEqual({
      error: "Only admins can update organization details",
    });
    expect(updateCalled).toBe(false);
  });
});
