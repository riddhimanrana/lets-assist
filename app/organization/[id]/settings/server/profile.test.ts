import { beforeEach, describe, expect, mock, test } from "bun:test";
import sharp from "sharp";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * `updateOrganization`/`checkUsernameAvailability` are the only Server
 * Actions that update `organizations.username`. RLS ("Allow admins to
 * update organizations") also lets an org admin update the row directly
 * through the Data API with no column-level `WITH CHECK` on username, so
 * the database constraint in
 * `20260812100000_organization_username_reserved_slugs.sql` (proven in
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
let uploadFails = false;
let accountDeletionPending: boolean | null = false;
let accountStatusError: { message: string } | null = null;
let accountStatusCalls = 0;
let referenceConflict = false;
let revokeMembershipOnUpload = false;
const updateFilters: Array<{
  operator: "eq" | "is";
  column: string;
  value: unknown;
}> = [];
const imageCalls: string[] = [];
let appliedUpdate: Record<string, unknown> | null = null;
let existingUsernames = new Set<string>();

function serverClient() {
  return {
    rpc: async (name: string) => {
      expect(name).toBe("account_deletion_pending");
      accountStatusCalls += 1;
      return { data: accountDeletionPending, error: accountStatusError };
    },
    storage: {
      from: () => ({
        getPublicUrl: (key: string) => ({
          data: {
            publicUrl: `https://storage.example.test/storage/v1/object/public/organization-logos/${key}`,
          },
        }),
        upload: async (key: string) => {
          imageCalls.push(`upload:${key}`);
          if (revokeMembershipOnUpload) isOrgAdmin = false;
          return {
            error: uploadFails ? new Error("Synthetic storage failure") : null,
          };
        },
        remove: async (keys: string[]) => {
          imageCalls.push(`remove:${keys.join()}`);
          return { error: null };
        },
      }),
    },
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
                  eq: () => ({
                    single: async () => ({
                      data: isOrgAdmin
                        ? { role: "admin", status: "active" }
                        : null,
                      error: null,
                    }),
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
                data: existingUsernames.has(value) ? { username: value } : null,
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
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: isOrgAdmin
                      ? { role: "admin", status: "active" }
                      : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table !== "organizations") {
        throw new Error(`adminClient: unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: currentOrgRow, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const settle = () => {
            updateCalled = true;
            appliedUpdate = patch;
            imageCalls.push("commit");
            return {
              data: updateError || referenceConflict ? null : { id: "org-1" },
              error: updateError,
            };
          };
          const query = {
            eq: (column: string, value: unknown) => {
              updateFilters.push({ operator: "eq", column, value });
              return query;
            },
            is: (column: string, value: unknown) => {
              updateFilters.push({ operator: "is", column, value });
              return query;
            },
            select: () => query,
            maybeSingle: async () => settle(),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(settle()).then(resolve),
          };
          return query;
        },
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

const { updateOrganization, checkUsernameAvailability } =
  await import("./profile");

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
  uploadFails = false;
  accountDeletionPending = false;
  accountStatusError = null;
  accountStatusCalls = 0;
  referenceConflict = false;
  revokeMembershipOnUpload = false;
  updateFilters.length = 0;
  imageCalls.length = 0;
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

  test("rejects invalid ASCII, length, dot, and astral formats", async () => {
    for (const value of [
      "ab",
      "a".repeat(33),
      ".abc",
      "abc.",
      "ab..cd",
      "with space",
      "abc😀",
      `ab${String.fromCodePoint(0x1d400)}`,
    ]) {
      expect(await checkUsernameAvailability(value)).toBe(false);
    }
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

  test("a direct Server Action call rejects every invalid username before update", async () => {
    for (const username of [
      "ab",
      "a".repeat(33),
      ".abc",
      "abc.",
      "ab..cd",
      "slash/name",
      "abc😀",
      `ab${String.fromCodePoint(0x1d400)}`,
    ]) {
      const result = await updateOrganization({
        ...baseUpdateData,
        username,
      });
      expect(result.error).toBeString();
    }
    expect(updateCalled).toBe(false);
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

  test("preserves an unchanged historical mixed-case username", async () => {
    currentOrgRow!.username = "SchoolClub";
    const result = await updateOrganization({
      ...baseUpdateData,
      username: "SchoolClub",
      name: "School Club Updated",
    });

    expect(result).toEqual({ success: true });
    expect(appliedUpdate?.username).toBe("SchoolClub");
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

describe("organization update account-deletion guard", () => {
  test.each([true, null])(
    "refuses an account without a confirmed active status: %s",
    async (status) => {
      accountDeletionPending = status;
      expect(
        await updateOrganization({
          ...baseUpdateData,
          username: "acme-nonprofit",
        }),
      ).toEqual({
        error: "You must be logged in to update an organization",
      });
      expect(accountStatusCalls).toBe(1);
      expect(updateCalled).toBe(false);
      expect(imageCalls).toEqual([]);
    },
  );

  test("a failed account-status lookup cannot authorize an update", async () => {
    accountStatusError = { message: "Synthetic account-status failure" };
    expect(
      await updateOrganization({
        ...baseUpdateData,
        username: "acme-nonprofit",
      }),
    ).toEqual({
      error: "You must be logged in to update an organization",
    });
    expect(accountStatusCalls).toBe(1);
    expect(updateCalled).toBe(false);
    expect(imageCalls).toEqual([]);
  });

  test("an unauthenticated caller cannot query account status or write", async () => {
    claims = null;
    expect(
      await updateOrganization({
        ...baseUpdateData,
        username: "acme-nonprofit",
      }),
    ).toEqual({
      error: "You must be logged in to update an organization",
    });
    expect(accountStatusCalls).toBe(0);
    expect(updateCalled).toBe(false);
    expect(imageCalls).toEqual([]);
  });
});

describe("organization logo replacement", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const oldKey = `${id}.png`;
  async function input() {
    currentOrgRow!.logo_url = `https://storage.example.test/storage/v1/object/public/organization-logos/${oldKey}`;
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    return {
      ...baseUpdateData,
      id,
      username: "acme-nonprofit",
      logoUrl: `data:image/png;base64,${image.toString("base64")}`,
    };
  }
  test("saves an immutable logo before retiring the custom-origin predecessor", async () => {
    const result = await updateOrganization(await input());
    expect(result).toEqual({ success: true });
    expect(imageCalls[0]).toStartWith(`upload:${id}.`);
    expect(imageCalls[1]).toBe("commit");
    expect(imageCalls[2]).toBe(`remove:${oldKey}`);
    expect(appliedUpdate?.logo_url).toMatch(/\.webp$/);
    expect(updateFilters).toEqual([
      { operator: "eq", column: "id", value: id },
      { operator: "eq", column: "logo_url", value: currentOrgRow!.logo_url },
    ]);
  });
  test("storage refusal leaves the organization reference and prior logo alone", async () => {
    uploadFails = true;
    const result = await updateOrganization(await input());
    expect(result.error).toBeString();
    expect(updateCalled).toBe(false);
    expect(imageCalls).toHaveLength(1);
  });
  test("uncertain reference commit never deletes the predecessor or candidate", async () => {
    updateError = { message: "Synthetic database failure" };
    const result = await updateOrganization(await input());
    expect(result.error).toBeString();
    expect(imageCalls).toHaveLength(2);
  });
  test("a competing reference update removes only this request's candidate", async () => {
    referenceConflict = true;
    const result = await updateOrganization(await input());
    expect(result.error).toBe(
      "The image changed while you were editing. Refresh before trying again.",
    );
    const uploadedKey = imageCalls[0].slice("upload:".length);
    expect(imageCalls).toEqual([
      `upload:${uploadedKey}`,
      "commit",
      `remove:${uploadedKey}`,
    ]);
    expect(uploadedKey).not.toBe(oldKey);
    expect(updateFilters).toContainEqual({
      operator: "eq",
      column: "logo_url",
      value: currentOrgRow!.logo_url,
    });
  });
  test("membership revoked during upload prevents the reference commit", async () => {
    revokeMembershipOnUpload = true;
    const result = await updateOrganization(await input());
    expect(result.error).toBeString();
    const uploadedKey = imageCalls[0].slice("upload:".length);
    expect(imageCalls).toEqual([
      `upload:${uploadedKey}`,
      `remove:${uploadedKey}`,
    ]);
    expect(updateCalled).toBe(false);
    expect(updateFilters).toEqual([]);
  });
});
