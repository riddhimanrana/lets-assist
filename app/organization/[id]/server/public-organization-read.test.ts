import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const serverReact = require(
  join(
    dirname(require.resolve("react/package.json")),
    "cjs/react.react-server.development.js",
  ),
);
const internals =
  serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const previousDispatcher = internals.A;
mock.module("react", () => ({ cache: serverReact.cache }));
let name = "Fictional chapter",
  missing = false;
const reads: Array<{
  source: string;
  table: string;
  fields: string;
  key: string;
  value: string;
}> = [];
function client(source: string) {
  return {
    from: (table: string) => ({
      select: (fields: string) => ({
        eq: (key: string, value: string) => ({
          single: async () => {
            reads.push({ source, table, fields, key, value });
            return {
              data: missing
                ? null
                : {
                    id: "00000000-0000-4000-8000-000000000001",
                    username: "fictional",
                    name,
                  },
              error: null,
            };
          },
        }),
      }),
    }),
  };
}
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client("local"),
}));
mock.module("@/lib/supabase/preview-source", () => ({
  createRemoteReadonlyClient: () => client("remote"),
}));
const { getPublicOrganizationForRender } =
  await import("./public-organization-read");
function startRender() {
  // Use React's real server cache with a fresh renderer cache for each request.
  const values = new Map<() => unknown, unknown>();
  internals.A = {
    getCacheForType: (factory: () => unknown) => {
      if (!values.has(factory)) values.set(factory, factory());
      return values.get(factory);
    },
  };
}
beforeEach(() => {
  reads.length = 0;
  name = "Fictional chapter";
  missing = false;
  startRender();
});
afterEach(() => {
  internals.A = previousDispatcher;
});
test("metadata and page share one public lookup within the render", async () => {
  const [metadata, page] = await Promise.all([
    getPublicOrganizationForRender("fictional", "local"),
    getPublicOrganizationForRender("fictional", "local"),
  ]);
  expect(metadata).toBe(page);
  expect(reads).toHaveLength(1);
  expect(reads[0].table).toBe("organization_public_read_model");
  expect(reads[0].fields.split(",")).toEqual([
    "id",
    "username",
    "name",
    "description",
    "website",
    "logo_url",
    "type",
    "verified",
    "created_at",
    "show_members_publicly",
    "public_member_count",
  ]);
  expect(reads[0].key).toBe("username");
});
test("a later request gets fresh data and preview sources never share results", async () => {
  expect(
    (await getPublicOrganizationForRender("fictional", "local"))?.name,
  ).toBe(name);
  await getPublicOrganizationForRender("fictional", "remote");
  expect(reads.map((row) => row.source)).toEqual(["local", "remote"]);
  name = "Updated chapter";
  startRender();
  expect(
    (await getPublicOrganizationForRender("fictional", "local"))?.name,
  ).toBe("Updated chapter");
  expect(reads).toHaveLength(3);
});
test("UUID lookups use id directly and missing records are shared only within a request", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  await getPublicOrganizationForRender(id, "local");
  expect(reads[0].key).toBe("id");
  expect(reads).toHaveLength(1);
  missing = true;
  expect(await getPublicOrganizationForRender("missing", "local")).toBeNull();
  expect(await getPublicOrganizationForRender("missing", "local")).toBeNull();
  expect(reads).toHaveLength(2);
  startRender();
  missing = false;
  expect(
    await getPublicOrganizationForRender("missing", "local"),
  ).not.toBeNull();
});
