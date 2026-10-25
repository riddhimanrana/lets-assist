import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The request query on a standalone plugin route.
 *
 * The platform forwards it to the plugin's renderer untouched and carries it
 * across its own two redirects. It never reads a key, and it never lets the
 * query move a redirect off the internal path this module built or change who
 * may reach the plugin. All identities are fictional.
 */

mock.module("server-only", () => ({}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

type RenderedProps = { userRole: string; searchParams?: unknown };
const pageProps: RenderedProps[] = [];
const routeProps: (RenderedProps & { routePath: string })[] = [];
let authUser: { id: string } | null;
let membershipStatus: "active" | "inactive";
let organizationUsername: string | null;

class Query {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  async maybeSingle() {
    const row: Record<string, unknown> =
      this.table === "organizations"
        ? {
            id: ORGANIZATION_ID,
            name: "Test Organization",
            username: organizationUsername,
          }
        : {
            organization_id: ORGANIZATION_ID,
            user_id: "user-1",
            role: "member",
            status: membershipStatus,
          };
    const matches = this.filters.every(
      ([column, value]) => row[column] === value,
    );
    return { data: matches ? row : null, error: null };
  }
}

const client = {
  from(table: string) {
    return new Query(table);
  },
};

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => client,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: authUser }),
}));
mock.module("@/lib/plugins/organization-plugin-context", () => ({
  readOrganizationPluginContext: async (
    _label: string,
    load: () => Promise<{ data: unknown }>,
  ) => (await load()).data,
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => ({
    manifest: {
      key: "private-plugin",
      name: "Private Plugin",
      version: "1.0.0",
      visibility: "private",
      minimumRole: "member",
      routes: [
        { path: "public-info", label: "Public", minimumRole: "public" },
        { path: "review", label: "Review", minimumRole: "member" },
      ],
    },
    renderOrganizationPage: async (props: RenderedProps) => {
      pageProps.push(props);
      return "private page";
    },
    renderOrganizationRoute: async (
      routePath: string,
      props: RenderedProps,
    ) => {
      routeProps.push({ ...props, routePath });
      return "plugin route";
    },
  }),
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPluginByKey: async () => ({
    key: "private-plugin",
    name: "Private Plugin",
    description: "Private",
    configuration: {},
  }),
}));

const { renderOrganizationPluginPage } =
  await import("./render-organization-plugin-page");

type Options = Parameters<typeof renderOrganizationPluginPage>[0];

/** The redirect a render throws, or a failure if it rendered instead. */
async function redirectOf(options: Options) {
  try {
    await renderOrganizationPluginPage(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:"))
      return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

/** A redirect target read the way a browser on this origin would read it. */
const ORIGIN = "https://app.example.test";
const resolved = (target: string) => new URL(target, ORIGIN);

beforeEach(() => {
  pageProps.length = 0;
  routeProps.length = 0;
  authUser = { id: "user-1" };
  membershipStatus = "active";
  organizationUsername = "test-org";
});

describe("the query reaches the plugin's renderer as it was received", () => {
  const searchParams = {
    q: "Núñez & O'Brien",
    filter: ["one", "two", "one"],
    empty: "",
    absent: undefined,
  };

  test("a plugin page receives every key, repeated values in order, untouched", async () => {
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      searchParams,
    });
    expect(pageProps).toHaveLength(1);
    expect(pageProps[0].searchParams).toEqual(searchParams);
    expect(pageProps[0].userRole).toBe("member");
  });

  test("a plugin subroute receives the same query", async () => {
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      routePath: "review",
      searchParams,
    });
    expect(routeProps).toHaveLength(1);
    expect(routeProps[0].routePath).toBe("review");
    expect(routeProps[0].searchParams).toEqual(searchParams);
  });

  test("a request with no query passes none", async () => {
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
    });
    expect(pageProps[0].searchParams).toBeUndefined();
  });

  test("the platform does not interpret a key that looks like its own", async () => {
    // Nothing here is a platform instruction. It is plugin input.
    const hostile = {
      userRole: "admin",
      organizationId: "another-organization",
      configuration: "{}",
    };
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      searchParams: hostile,
    });
    expect(pageProps[0].userRole).toBe("member");
    expect(pageProps[0].searchParams).toEqual(hostile);
  });
});

describe("the query does not change who reaches the plugin", () => {
  const searchParams = { userRole: "admin", status: "active", tab: "review" };

  test("an inactive member is still refused a private page", async () => {
    membershipStatus = "inactive";
    await expect(
      renderOrganizationPluginPage({
        organizationIdentifier: "test-org",
        pluginKey: "private-plugin",
        searchParams,
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(pageProps).toEqual([]);
  });

  test("an inactive member is still refused a member subroute", async () => {
    membershipStatus = "inactive";
    await expect(
      renderOrganizationPluginPage({
        organizationIdentifier: "test-org",
        pluginKey: "private-plugin",
        routePath: "review",
        searchParams,
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(routeProps).toEqual([]);
  });

  test("an inactive member reaches a public route as public, with the query", async () => {
    membershipStatus = "inactive";
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      routePath: "public-info",
      searchParams,
    });
    expect(routeProps.map((props) => props.userRole)).toEqual(["public"]);
    expect(routeProps[0].searchParams).toEqual(searchParams);
  });

  test("an anonymous visitor reaches a public route as public, with the query", async () => {
    authUser = null;
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      routePath: "public-info",
      searchParams,
    });
    expect(routeProps.map((props) => props.userRole)).toEqual(["public"]);
    expect(routeProps[0].searchParams).toEqual(searchParams);
  });
});

describe("the canonical redirect keeps the query on the internal path", () => {
  test("an id address moves to the slug with every parameter, encoded and in order", async () => {
    const target = await redirectOf({
      organizationIdentifier: ORGANIZATION_ID,
      pluginKey: "private-plugin",
      routePath: "review",
      searchParams: {
        q: "Núñez & O'Brien=1",
        filter: ["one", "two", "one"],
        empty: "",
        absent: undefined,
      },
    });
    const url = resolved(target);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe(
      "/organization/test-org/plugins/private-plugin/review",
    );
    expect(url.hash).toBe("");
    expect([...url.searchParams]).toEqual([
      ["q", "Núñez & O'Brien=1"],
      ["filter", "one"],
      ["filter", "two"],
      ["filter", "one"],
      ["empty", ""],
    ]);
    // The ampersand and the equals sign inside a value stay inside it.
    expect(target).not.toContain("& ");
    expect(target).toContain("%26");
  });

  test("an id address with no query redirects to the bare slug path", async () => {
    expect(
      await redirectOf({
        organizationIdentifier: ORGANIZATION_ID,
        pluginKey: "private-plugin",
      }),
    ).toBe("/organization/test-org/plugins/private-plugin");
  });

  test("a slug address is not redirected", async () => {
    await renderOrganizationPluginPage({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      searchParams: { q: "one" },
    });
    expect(pageProps).toHaveLength(1);
  });

  test.each([
    ["an absolute URL value", { next: "https://evil.example.test/x" }],
    ["a scheme-relative value", { redirect: "//evil.example.test/x" }],
    ["a scheme-relative key", { "//evil.example.test/x": "1" }],
    ["a fragment in a value", { tab: "x#/../../login" }],
    ["a fragment in a key", { "#frag": "x" }],
    ["a path traversal value", { p: "../../../../login" }],
    ["a second query marker", { q: "?tab=other&admin=1" }],
    ["a header break", { h: "a\r\nLocation: https://evil.example.test" }],
    ["a backslash host", { u: "\\\\evil.example.test\\x" }],
  ] as const)(
    "%s cannot move the redirect off the plugin's own path",
    async (_name, searchParams) => {
      const target = await redirectOf({
        organizationIdentifier: ORGANIZATION_ID,
        pluginKey: "private-plugin",
        searchParams,
      });
      // The target is a path on this origin, whatever resolves it.
      expect(target.startsWith("/organization/test-org/plugins/")).toBe(true);
      expect(target).not.toMatch(/[\r\n\\#]/u);
      const url = resolved(target);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe(
        "/organization/test-org/plugins/private-plugin",
      );
      expect(url.hash).toBe("");
      // And the value arrives exactly as it was sent, as data.
      const [[key, value]] = Object.entries(searchParams);
      expect(url.searchParams.get(key)).toBe(value);
      expect([...url.searchParams]).toHaveLength(1);
    },
  );
});

describe("the sign-in redirect returns to the same internal address", () => {
  test("an anonymous visitor to a private page is sent to sign in with the whole address as one value", async () => {
    authUser = null;
    const target = await redirectOf({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      routePath: "review",
      searchParams: { q: "Núñez & O'Brien", filter: ["one", "two"] },
    });
    const url = resolved(target);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/login");
    // The plugin's query is inside the return address, not beside it.
    expect([...url.searchParams.keys()]).toEqual(["redirect"]);

    const returnTo = url.searchParams.get("redirect") ?? "";
    expect(returnTo.startsWith("/organization/test-org/plugins/")).toBe(true);
    const back = resolved(returnTo);
    expect(back.origin).toBe(ORIGIN);
    expect(back.pathname).toBe(
      "/organization/test-org/plugins/private-plugin/review",
    );
    expect([...back.searchParams]).toEqual([
      ["q", "Núñez & O'Brien"],
      ["filter", "one"],
      ["filter", "two"],
    ]);
  });

  test("a hostile query cannot add a parameter to the sign-in address or move the return off-origin", async () => {
    authUser = null;
    const target = await redirectOf({
      organizationIdentifier: "test-org",
      pluginKey: "private-plugin",
      searchParams: {
        redirect: "https://evil.example.test/",
        "x&redirect": "//evil.example.test/",
        next: "/admin",
      },
    });
    const url = resolved(target);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.getAll("redirect")).toHaveLength(1);
    expect([...url.searchParams.keys()]).toEqual(["redirect"]);

    const returnTo = url.searchParams.get("redirect") ?? "";
    const back = resolved(returnTo);
    expect(back.origin).toBe(ORIGIN);
    expect(back.pathname).toBe("/organization/test-org/plugins/private-plugin");
    expect(back.searchParams.get("redirect")).toBe(
      "https://evil.example.test/",
    );
  });

  test("with no query the return address is the bare path, as before", async () => {
    authUser = null;
    expect(
      await redirectOf({
        organizationIdentifier: "test-org",
        pluginKey: "private-plugin",
      }),
    ).toBe(
      `/login?redirect=${encodeURIComponent("/organization/test-org/plugins/private-plugin")}`,
    );
  });
});
