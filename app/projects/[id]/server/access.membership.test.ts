import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;

const VIEWER_ID = "fictional-viewer";
const CREATOR_ID = "fictional-creator";
const ORGANIZATION_ID = "fictional-organization";

let viewer: { id: string } | null = { id: VIEWER_ID };
let project: Row | null = null;
let memberships: Row[] = [];
let membershipReadError: { message: string } | null = null;
let membershipFilters: unknown[][][] = [];

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: viewer, error: null }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("Unexpected service client");
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: unknown[][] = [];
      const builder: Record<string, unknown> = {};
      // Behaves like the table: only rows matching every filter come back.
      const rows = () =>
        memberships.filter((row) =>
          filters.every(([column, value]) => row[column as string] === value),
        );
      const settle = () => {
        if (table === "projects") return { data: project, error: null };
        if (table !== "organization_members") {
          throw new Error(`Unexpected table ${table}`);
        }
        membershipFilters.push(filters);
        return membershipReadError
          ? { data: null, error: membershipReadError }
          : { data: rows(), error: null };
      };
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      };
      builder.maybeSingle = async () => {
        const result = settle();
        return Array.isArray(result.data)
          ? { ...result, data: result.data[0] ?? null }
          : result;
      };
      builder.single = builder.maybeSingle;
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(settle()).then(onFulfilled, onRejected);
      return builder;
    },
  }),
}));

const { getCurrentUserProjectPermissions, getProject } =
  await import("./access");

function organizationProject(overrides: Row = {}): Row {
  return {
    id: "fictional-project",
    creator_id: CREATOR_ID,
    organization_id: ORGANIZATION_ID,
    visibility: "organization_only",
    workflow_status: "published",
    can_be_managed_by_staff: true,
    ...overrides,
  };
}

function membership(role: string, status: string | null, overrides: Row = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    user_id: VIEWER_ID,
    role,
    status,
    ...overrides,
  };
}

const UNAUTHORIZED = { error: "unauthorized", project: null };

/**
 * The whole outcome of the read. The fixture row holds only the columns the
 * access decision uses, so it is compared as returned rather than as a typed
 * Project.
 */
async function readOutcome(): Promise<unknown> {
  return getProject("fictional-project");
}

beforeEach(() => {
  viewer = { id: VIEWER_ID };
  project = organizationProject();
  memberships = [];
  membershipReadError = null;
  membershipFilters = [];
});

describe("organization-only project reads require an active membership", () => {
  for (const role of ["admin", "staff", "member"]) {
    test(`an active ${role} reads the project`, async () => {
      memberships = [membership(role, "active")];

      expect(await readOutcome()).toEqual({ project });
    });
  }

  for (const status of ["inactive", "pending", "suspended", null]) {
    test(`a staff membership whose status is ${status} does not read the project`, async () => {
      memberships = [membership("staff", status)];

      expect(await getProject("fictional-project")).toEqual(UNAUTHORIZED);
    });
  }

  test("the membership read is limited to the viewer's active rows", async () => {
    memberships = [membership("member", "active")];

    await getProject("fictional-project");

    expect(membershipFilters).toEqual([
      [
        ["user_id", VIEWER_ID],
        ["status", "active"],
      ],
    ]);
  });

  test("an active membership of another organization does not read the project", async () => {
    memberships = [
      membership("admin", "active", {
        organization_id: "another-organization",
      }),
    ];

    expect(await getProject("fictional-project")).toEqual(UNAUTHORIZED);
  });

  test("a failed membership read grants nothing", async () => {
    memberships = [membership("admin", "active")];
    membershipReadError = { message: "synthetic outage" };

    expect(await getProject("fictional-project")).toEqual(UNAUTHORIZED);
  });

  test("a signed-out visitor does not read the project", async () => {
    viewer = null;

    expect(await getProject("fictional-project")).toEqual(UNAUTHORIZED);
    expect(membershipFilters).toEqual([]);
  });
});

describe("access that does not depend on membership is preserved", () => {
  test("the creator reads their own project after their membership lapsed", async () => {
    project = organizationProject({ creator_id: VIEWER_ID });
    memberships = [membership("staff", "inactive")];

    expect(await readOutcome()).toEqual({ project });
  });

  for (const visibility of ["public", "unlisted"]) {
    test(`a published ${visibility} project is read without a membership`, async () => {
      project = organizationProject({ visibility });
      memberships = [membership("staff", "inactive")];

      expect(await readOutcome()).toEqual({ project });
      expect(membershipFilters).toEqual([]);

      viewer = null;
      expect(await readOutcome()).toEqual({ project });
    });
  }

  test("an unpublished project stays closed to an inactive admin", async () => {
    project = organizationProject({
      visibility: "unlisted",
      workflow_status: "draft",
    });
    memberships = [membership("admin", "inactive")];

    expect(await getProject("fictional-project")).toEqual(UNAUTHORIZED);
  });
});

describe("management permissions follow the active role", () => {
  test("an active admin manages the project", async () => {
    memberships = [membership("admin", "active")];

    expect(await getCurrentUserProjectPermissions("fictional-project")).toEqual(
      {
        userId: VIEWER_ID,
        isCreator: false,
        isOrgAdmin: true,
        canManageProject: true,
      },
    );
  });

  for (const status of ["inactive", "pending", null]) {
    test(`an admin whose status is ${status} manages nothing`, async () => {
      memberships = [membership("admin", status)];

      expect(
        await getCurrentUserProjectPermissions("fictional-project"),
      ).toEqual({
        userId: VIEWER_ID,
        isCreator: false,
        isOrgAdmin: false,
        canManageProject: false,
      });
    });
  }
});
