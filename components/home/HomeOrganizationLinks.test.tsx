import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let source = "local";
let remoteAvailable = true;
let mappedUserId: string | null = "remote-member";
let queryError = false;
const calls: Array<{ source: string; field: string; value: string }> = [];
const mappingCalls: Array<string | null | undefined> = [];

function client(label: string) {
  return {
    from(table: string) {
      expect(table).toBe("organization_members");
      return {
        select(columns: string) {
          expect(columns).toBe(
            "organization_id, organization:organizations(id, name, username)",
          );
          const query = {
            eq(field: string, value: string) {
              calls.push({ source: label, field, value });
              return query;
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({
                error: queryError ? { message: "Unavailable" } : null,
                data: [
                  {
                    organization_id: `${label}-org`,
                    organization: {
                      id: `${label}-org`,
                      name: `${label} chapter`,
                      username: `${label}-chapter`,
                    },
                  },
                ],
              }).then(resolve);
            },
          };
          return query;
        },
      };
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client("local"),
}));
mock.module("@/lib/supabase/preview-source.server", () => ({
  getServerPreviewSource: async () => source,
}));
mock.module("@/lib/supabase/preview-source", () => ({
  createRemoteReadonlyClient: () => (remoteAvailable ? client("remote") : null),
  getRemoteUserIdForLocalUser: (email: string | null | undefined) => {
    mappingCalls.push(email);
    return mappedUserId;
  },
}));

const { HomeOrganizationLinks } = await import("./HomeOrganizationLinks");

beforeEach(() => {
  source = "local";
  remoteAvailable = true;
  mappedUserId = "remote-member";
  queryError = false;
  calls.length = 0;
  mappingCalls.length = 0;
});

async function renderLinks() {
  return renderToStaticMarkup(
    await HomeOrganizationLinks({
      userId: "local-member",
      userEmail: "fictional@example.test",
    }),
  );
}

test("local mode uses the signed-in local account and active memberships", async () => {
  expect(await renderLinks()).toContain('href="/organization/local-chapter"');
  expect(mappingCalls).toEqual([]);
  expect(calls).toEqual([
    { source: "local", field: "user_id", value: "local-member" },
    { source: "local", field: "status", value: "active" },
  ]);
});

test("remote preview uses the configured remote identity and destination", async () => {
  source = "remote";
  const html = await renderLinks();
  expect(html).toContain('href="/organization/remote-chapter"');
  expect(html).not.toContain("local-chapter");
  expect(mappingCalls).toEqual(["fictional@example.test"]);
  expect(calls).toEqual([
    { source: "remote", field: "user_id", value: "remote-member" },
    { source: "remote", field: "status", value: "active" },
  ]);
});

test("remote preview without a mapping uses the same ID fallback as Organizations", async () => {
  source = "remote";
  mappedUserId = null;
  await renderLinks();
  expect(calls[0]).toEqual({
    source: "remote",
    field: "user_id",
    value: "local-member",
  });
});

test("unavailable remote configuration keeps the local source and identity together", async () => {
  source = "remote";
  remoteAvailable = false;
  expect(await renderLinks()).toContain('href="/organization/local-chapter"');
  expect(mappingCalls).toEqual([]);
  expect(calls[0]).toEqual({
    source: "local",
    field: "user_id",
    value: "local-member",
  });
});

test("a membership read error renders no organization links", async () => {
  queryError = true;
  expect(await renderLinks()).toBe("");
});
