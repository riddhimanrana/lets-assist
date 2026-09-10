import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let source = "local";
let queryError = false;
const calls: Array<{ source: string; field: string; value: string }> = [];

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

const createClient = mock(async () => client("local"));
mock.module("@/lib/supabase/server", () => ({ createClient }));
mock.module("@/lib/supabase/preview-source.server", () => ({
  getServerPreviewSource: async () => source,
}));
mock.module("@/lib/supabase/preview-source", () => ({
  createRemoteReadonlyClient: () => {
    throw new Error("Anonymous preview must not query private memberships");
  },
  getRemoteUserIdForLocalUser: () => {
    throw new Error("A local email map does not authorize remote membership");
  },
}));

const { HomeOrganizationLinks } = await import("./HomeOrganizationLinks");

beforeEach(() => {
  source = "local";
  queryError = false;
  calls.length = 0;
  createClient.mockClear();
});

async function renderLinks() {
  return renderToStaticMarkup(
    await HomeOrganizationLinks({
      userId: "local-member",
    }),
  );
}

test("local mode uses the signed-in local account and active memberships", async () => {
  expect(await renderLinks()).toContain('href="/organization/local-chapter"');
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([
    { source: "local", field: "user_id", value: "local-member" },
    { source: "local", field: "status", value: "active" },
  ]);
});

test("anonymous remote preview offers the directory without reading memberships", async () => {
  source = "remote";
  const html = await renderLinks();
  expect(html).toContain('href="/organization"');
  expect(html).toContain("Open organizations");
  expect(html).not.toContain("local-chapter");
  expect(html).not.toContain("Your organizations");
  expect(createClient).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("a membership read error renders no organization links", async () => {
  queryError = true;
  expect(await renderLinks()).toBe("");
});
