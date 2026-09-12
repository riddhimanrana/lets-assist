import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let source = "local";
let queryError = false;
let isMember = true;
let useSlug = true;
let hasLogo = true;
let showPluginContent = true;
let hiddenPluginKeys: string[] = [];
let accessibleOrganizationIds = ["local-org"];
let accessiblePluginKey = "dvhs-csf";
let extraOrganization = false;
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
                      ...(extraOrganization
                        ? [
                            {
                              organization_id: "other-org",
                              organization: {
                                id: "other-org",
                                name: "Other group",
                                username: "other-group",
                                logo_url: null,
                              },
                            },
                          ]
                        : []),
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
const loadPluginDisplayPreferences = mock(async () => ({
  showPluginContent,
  hiddenPluginKeys,
}));
const resolveOrganizationPluginExperiences = mock(
  async (organizationIds: string[]) =>
    organizationIds
      .filter((organizationId) =>
        accessibleOrganizationIds.includes(organizationId),
      )
      .map((organizationId) => ({
        organizationId,
        pluginKey: accessiblePluginKey,
        experience: {},
      })),
);
mock.module("@/lib/supabase/server", () => ({ createClient }));
mock.module("@/lib/plugins/plugin-display-preferences", () => ({
  loadPluginDisplayPreferences,
  isPluginHidden: (
    preferences: { hiddenPluginKeys: string[] },
    pluginKey: string,
  ) => preferences.hiddenPluginKeys.includes(pluginKey),
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPluginExperiences,
}));
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
  showPluginContent = true;
  hiddenPluginKeys = [];
  accessibleOrganizationIds = ["local-org"];
  accessiblePluginKey = "dvhs-csf";
  extraOrganization = false;
  calls.length = 0;
  createClient.mockClear();
  loadPluginDisplayPreferences.mockClear();
  resolveOrganizationPluginExperiences.mockClear();
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

test("only organizations with accessible DVHS CSF installs receive a shortcut", async () => {
  extraOrganization = true;
  const html = await renderLinks();
  expect(html).toContain("local chapter");
  expect(html).not.toContain("Other group");
  expect(resolveOrganizationPluginExperiences).toHaveBeenCalledWith([
    "local-org",
    "other-org",
  ]);
});

test("accounts without an accessible DVHS CSF install receive no shortcut", async () => {
  accessibleOrganizationIds = [];
  expect(await renderLinks()).toBe("");
});

test("access to another plugin does not create an organization shortcut", async () => {
  accessiblePluginKey = "other-plugin";
  expect(await renderLinks()).toBe("");
});

test("the global plugin content setting hides the CSF shortcut", async () => {
  showPluginContent = false;
  expect(await renderLinks()).toBe("");
  expect(resolveOrganizationPluginExperiences).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("the DVHS CSF content setting hides the CSF shortcut", async () => {
  hiddenPluginKeys = ["dvhs-csf"];
  expect(await renderLinks()).toBe("");
  expect(resolveOrganizationPluginExperiences).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("organization without a logo or slug retains accessible direct navigation", async () => {
  useSlug = false;
  hasLogo = false;
  const html = await renderLinks();
  expect(html).toContain('href="/organization/local-org"');
  expect(html).toContain("Open local chapter");
  expect(html).not.toContain("chapter-logo.png");
});
