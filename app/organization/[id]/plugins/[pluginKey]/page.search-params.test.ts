import { beforeEach, expect, mock, test } from "bun:test";

/**
 * The two standalone plugin routes hand the request's query to the renderer.
 *
 * Next passes `searchParams` to a page as a promise. These call the real page
 * modules with one and record what the renderer was given.
 */

const calls: Record<string, unknown>[] = [];
mock.module("@/lib/plugins/render-organization-plugin-page", () => ({
  renderOrganizationPluginPage: async (options: Record<string, unknown>) => {
    calls.push(options);
    return null;
  },
}));

const { default: OrganizationPluginPage } = await import("./page");
const { default: OrganizationPluginSubroutePage } =
  await import("./[...pluginRoute]/page");

const searchParams = {
  q: "Núñez & O'Brien",
  filter: ["one", "two"],
  absent: undefined,
};

beforeEach(() => {
  calls.length = 0;
});

test("the plugin page awaits the query and forwards it unchanged", async () => {
  await OrganizationPluginPage({
    params: Promise.resolve({ id: "test-org", pluginKey: "private-plugin" }),
    searchParams: Promise.resolve(searchParams),
  });
  expect(calls).toEqual([
    {
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      searchParams,
    },
  ]);
  // The same object, not a filtered or rebuilt copy.
  expect(calls[0].searchParams).toBe(searchParams);
});

test("the plugin subroute awaits the query and forwards it with its route path", async () => {
  await OrganizationPluginSubroutePage({
    params: Promise.resolve({
      id: "test-org",
      pluginKey: "private-plugin",
      pluginRoute: ["cohorts", "class-1", "submissions"],
    }),
    searchParams: Promise.resolve(searchParams),
  });
  expect(calls).toEqual([
    {
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      routePath: "cohorts/class-1/submissions",
      searchParams,
    },
  ]);
  expect(calls[0].searchParams).toBe(searchParams);
});

test("a request with no query forwards an empty one", async () => {
  await OrganizationPluginPage({
    params: Promise.resolve({ id: "test-org", pluginKey: "private-plugin" }),
    searchParams: Promise.resolve({}),
  });
  expect(calls[0].searchParams).toEqual({});
});
