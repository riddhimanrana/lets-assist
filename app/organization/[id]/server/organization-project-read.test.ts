import { expect, test } from "bun:test";
import { readOrganizationProjects } from "./organization-project-read";
const records = [
  {
    id: "public",
    organization_id: "one",
    visibility: "public",
    workflow_status: "published",
  },
  {
    id: "unlisted",
    organization_id: "one",
    visibility: "unlisted",
    workflow_status: "published",
  },
  {
    id: "members",
    organization_id: "one",
    visibility: "organization_only",
    workflow_status: "published",
  },
  {
    id: "draft",
    organization_id: "one",
    visibility: "public",
    workflow_status: "draft",
  },
  {
    id: "other-org",
    organization_id: "two",
    visibility: "public",
    workflow_status: "published",
  },
];
const troopId = "26bc1fa3-7f83-403c-bde1-2737bb71ca79";
const troopRecords = [
  ...records.map((record) => ({
    ...record,
    organization_id: record.organization_id === "one" ? troopId : "two",
    title: "Volunteer project",
    status: "completed",
  })),
  {
    id: "test-colon",
    organization_id: troopId,
    title: "TEST: signup",
    visibility: "unlisted",
    workflow_status: "published",
    status: "completed",
  },
  {
    id: "test-bracket",
    organization_id: troopId,
    title: "[TEST] camp",
    visibility: "unlisted",
    workflow_status: "published",
    status: "completed",
  },
  {
    id: "cancelled",
    organization_id: troopId,
    title: "Cancelled project",
    visibility: "unlisted",
    workflow_status: "published",
    status: "cancelled",
  },
  {
    id: "not-linked",
    organization_id: "",
    title: "Not linked",
    visibility: "unlisted",
    workflow_status: "published",
    status: "completed",
  },
];
function client(input: Record<string, string>[] = records) {
  let rows: Record<string, string>[] = input;
  const query = {
    select: () => query,
    eq: (field: string, value: string) => {
      rows = rows.filter((r) => r[field] === value);
      return query;
    },
    in: (field: string, values: string[]) => {
      rows = rows.filter((r) => values.includes(r[field]));
      return query;
    },
    or: (expression: string) => {
      expect(expression).toBe(
        "visibility.in.(public,organization_only),and(visibility.eq.unlisted,status.neq.cancelled,title.not.ilike.TEST:*,title.not.ilike.[TEST]*)",
      );
      rows = rows.filter(
        (row) =>
          ["public", "organization_only"].includes(row.visibility) ||
          (row.visibility === "unlisted" &&
            row.status !== "cancelled" &&
            !/^(TEST:|\[TEST\])/i.test(row.title)),
      );
      return query;
    },
    order: async () => ({ data: rows, error: null }),
  };
  return { from: () => query } as unknown as Parameters<
    typeof readOrganizationProjects
  >[0];
}
test("public organization discovery excludes unlisted, drafts and other organizations", async () => {
  expect(
    (await readOrganizationProjects(client(), "one", null)).data?.map(
      (p) => p.id,
    ),
  ).toEqual(["public"]);
});
test("membership adds member projects without listing unlisted links", async () => {
  expect(
    (await readOrganizationProjects(client(), "one", "member")).data?.map(
      (p) => p.id,
    ),
  ).toEqual(["public", "members"]);
});

test("Troop active member discovery adds real unlisted projects only", async () => {
  expect(
    (
      await readOrganizationProjects(client(troopRecords), troopId, "member")
    ).data?.map((p) => p.id),
  ).toEqual(["public", "unlisted", "members"]);
});
test("Troop nonmember discovery stays public-only", async () => {
  expect(
    (
      await readOrganizationProjects(client(troopRecords), troopId, null)
    ).data?.map((p) => p.id),
  ).toEqual(["public"]);
});
test("Troop opt-in never carries into another organization", async () => {
  expect(
    (
      await readOrganizationProjects(client(troopRecords), "two", "member")
    ).data?.map((p) => p.id),
  ).toEqual(["other-org"]);
});

test("organization admins and staff see their own unlisted projects", async () => {
  for (const role of ["admin", "staff"]) {
    expect(
      (await readOrganizationProjects(client(), "one", role)).data?.map(
        (p) => p.id,
      ),
    ).toEqual(["public", "unlisted", "members"]);
  }
});
test("admin listing stays inside the organization being viewed", async () => {
  expect(
    (await readOrganizationProjects(client(), "two", "admin")).data?.map(
      (p) => p.id,
    ),
  ).toEqual(["other-org"]);
});
test("Troop admins see every unlisted project they manage", async () => {
  expect(
    (
      await readOrganizationProjects(client(troopRecords), troopId, "admin")
    ).data?.map((p) => p.id),
  ).toEqual([
    "public",
    "unlisted",
    "members",
    "test-colon",
    "test-bracket",
    "cancelled",
  ]);
});
