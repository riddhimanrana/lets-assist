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
function client() {
  let rows: Record<string, string>[] = records;
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
    order: async () => ({ data: rows, error: null }),
  };
  return { from: () => query } as unknown as Parameters<
    typeof readOrganizationProjects
  >[0];
}
test("public organization discovery excludes unlisted, drafts and other organizations", async () => {
  expect(
    (await readOrganizationProjects(client(), "one", false)).data?.map(
      (p) => p.id,
    ),
  ).toEqual(["public"]);
});
test("membership adds member projects without listing unlisted links", async () => {
  expect(
    (await readOrganizationProjects(client(), "one", true)).data?.map(
      (p) => p.id,
    ),
  ).toEqual(["public", "members"]);
});
