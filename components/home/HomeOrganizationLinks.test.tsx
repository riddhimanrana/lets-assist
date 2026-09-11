import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let source = "local";
let queryError = false;
let isMember = true;
let useSlug = true;
let hasLogo = true;
const calls: Array<{ source: string; field: string; value: string }> = [];

function client(label: string) {
  return {
    from(table: string) {
      expect(table).toBe("organization_members");
      return {
        select(columns: string) {
          expect(columns).toBe(
            "organization_id, organization:organizations(id, name, username, logo_url)",
          );
          const query = {
            eq(field: string, value: string) {
              calls.push({ source: label, field, value });
              return query;
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({
                error: queryError ? { message: "Unavailable" } : null,
                data: isMember
                  ? [
                      {
                        organization_id: `${label}-org`,
                        organization: {
                          id: `${label}-org`,
                          name: `${label} chapter`,
                          username: useSlug ? `${label}-chapter` : null,
                          logo_url: hasLogo
                            ? "https://example.com/chapter-logo.png"
                            : null,
                        },
                      },
                    ]
                  : [],
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
  isMember = true;
  useSlug = true;
  hasLogo = true;
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

test("organization card shows its name and logo with one direct navigation link", async () => {
  const html = await renderLinks();
  expect(html).toContain('src="https://example.com/chapter-logo.png"');
  expect(html).toContain(
    '<h2 class="text-base font-semibold">local chapter</h2>',
  );
  expect(html.match(/href="\/organization\/local-chapter"/g)).toHaveLength(1);
  expect(html).toContain("Open local chapter");
});

test("accounts without active organization memberships receive no card", async () => {
  isMember = false;
  expect(await renderLinks()).toBe("");
});

test("organization without a logo or slug retains accessible direct navigation", async () => {
  useSlug = false;
  hasLogo = false;
  const html = await renderLinks();
  expect(html).toContain('href="/organization/local-org"');
  expect(html).toContain("Open local chapter");
  expect(html).not.toContain("chapter-logo.png");
});
