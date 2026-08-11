import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import type {
  OrganizationPluginDefinition,
  PlatformDashboardCard,
  PlatformFeedItemInput,
} from "@/types";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Harness: module boundaries are mocked so the resolver is exercised against
// controlled memberships, install rows, and plugin definitions. The role
// gate (`hasSurfaceAccess`) stays real.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let membershipRows: Row[] = [];
let installRows: Row[] = [];
// No row is the real default: someone who never opened the setting sees
// everything. Tests opt into a row only when they exercise the preference.
let preferenceRows: Row[] = [];
let failPreferenceRead = false;
const registeredPlugins = new Map<string, OrganizationPluginDefinition>();

// The real `loadAccessibleOrganizationPluginAccess` stays unmocked — it takes
// a query client, so the stub serves its consolidated-view read directly.
// (Mocking that module here would leak into its own test file: bun's
// mock.module is global to the whole test process.)
function tableQuery(table: string) {
  const rowsFor = () => {
    if (table === "organization_plugin_access") return installRows;
    if (table === "user_plugin_display_preferences") return preferenceRows;
    return membershipRows;
  };
  const errorFor = () =>
    failPreferenceRead && table === "user_plugin_display_preferences"
      ? { message: "preference read unavailable" }
      : null;
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (
      resolve: (value: {
        data: Row[] | null;
        error: { message: string } | null;
      }) => unknown,
    ) => {
      const error = errorFor();
      return resolve({ data: error ? null : rowsFor(), error });
    },
  };
  return chain;
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: tableQuery }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: tableQuery }),
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: (key: string) => registeredPlugins.get(key),
}));

const {
  listPlatformPluginSources,
  resolvePlatformDashboardCards,
  resolvePlatformFeedItems,
} = await import("@/lib/plugins/resolve-platform-surfaces");

const USER = "aa000000-0000-4000-8000-000000000001";
const ORG_A = "0a000000-0000-4000-8000-000000000001";
const ORG_B = "0b000000-0000-4000-8000-000000000001";

function membership(organizationId: string, role: string): Row {
  return {
    organization_id: organizationId,
    role,
    organization: {
      id: organizationId,
      name: `Org ${organizationId.slice(0, 2)}`,
      username: `org-${organizationId.slice(0, 2)}`,
    },
  };
}

function install(organizationId: string, pluginKey: string): Row {
  // Shaped as a consolidated organization_plugin_access view row so the REAL
  // loader (and its filterConsolidatedPluginAccessRows) accepts it.
  return {
    organization_id: organizationId,
    plugin_key: pluginKey,
    enabled: true,
    configuration: null,
    installed_at: "2026-08-01T00:00:00.000Z",
    installed_version: "1.0.0",
    visibility: "private",
    is_active: true,
    latest_version: "1.0.0",
    force_update_version: null,
    is_accessible: true,
  };
}

function feedItem(
  overrides: Partial<PlatformFeedItemInput> = {},
): PlatformFeedItemInput {
  return {
    id: "item-1",
    kind: "post",
    title: "A post",
    summary: "A summary",
    href: "/organization/org-0a/plugins/test/home",
    publishedAt: "2026-08-01T00:00:00.000Z",
    pinned: false,
    badgeLabel: "Test",
    ...overrides,
  };
}

function dashboardCard(
  overrides: Partial<PlatformDashboardCard> = {},
): PlatformDashboardCard {
  return {
    title: "Test plugin",
    href: "/organization/org-0a/plugins/test/home",
    stats: [{ label: "Points", value: "12 / 30" }],
    status: { label: "Active", tone: "positive" },
    ...overrides,
  };
}

function registerPlugin(
  key: string,
  definition: Partial<OrganizationPluginDefinition> & {
    feedLevel?: "member" | "staff" | "admin";
    cardLevel?: "member" | "staff" | "admin";
  },
) {
  const { feedLevel, cardLevel, ...rest } = definition;
  registeredPlugins.set(key, {
    manifest: {
      key,
      name: key,
      version: "1.0.0",
      visibility: "private",
      platformSurfaces: {
        ...(feedLevel ? { "platform.home.feed": feedLevel } : {}),
        ...(cardLevel ? { "platform.dashboard.card": cardLevel } : {}),
      },
    },
    ...rest,
  } as OrganizationPluginDefinition);
}

beforeEach(() => {
  membershipRows = [];
  installRows = [];
  preferenceRows = [];
  registeredPlugins.clear();
});

describe("resolvePlatformFeedItems", () => {
  test("returns nothing when the viewer role is below the surface level", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "staff-only")];
    let invoked = false;
    registerPlugin("staff-only", {
      feedLevel: "staff",
      resolvePlatformFeedItems: async () => {
        invoked = true;
        return [feedItem()];
      },
    });

    expect(await resolvePlatformFeedItems(USER)).toEqual([]);
    expect(invoked).toBe(false);
  });

  test("passes the role gate and hands the plugin a full viewer context", async () => {
    membershipRows = [membership(ORG_A, "staff")];
    installRows = [install(ORG_A, "staff-only")];
    let seenContext: Row | null = null;
    registerPlugin("staff-only", {
      feedLevel: "staff",
      resolvePlatformFeedItems: async (context) => {
        seenContext = context as unknown as Row;
        return [feedItem()];
      },
    });

    const items = await resolvePlatformFeedItems(USER, { limit: 3 });
    expect(items).toHaveLength(1);
    expect(seenContext).toMatchObject({
      organizationId: ORG_A,
      organizationSlug: "org-0a",
      userId: USER,
      viewerRole: "staff",
      pluginConfiguration: null,
      limit: 3,
    });
  });

  test("a hanging resolver times out without blocking other plugins", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      membershipRows = [
        membership(ORG_A, "member"),
        membership(ORG_B, "member"),
      ];
      installRows = [install(ORG_A, "hangs"), install(ORG_B, "works")];
      registerPlugin("hangs", {
        feedLevel: "member",
        resolvePlatformFeedItems: () => new Promise<never>(() => {}),
      });
      registerPlugin("works", {
        feedLevel: "member",
        resolvePlatformFeedItems: async () => [feedItem({ id: "healthy" })],
      });

      const items = await resolvePlatformFeedItems(USER, { timeoutMs: 25 });
      expect(items.map((item) => item.id)).toEqual(["healthy"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toInclude("hangs");
    } finally {
      warn.mockRestore();
    }
  });

  test("sanitizes items: bad hrefs are dropped and long strings truncated", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "test")];
    registerPlugin("test", {
      feedLevel: "member",
      resolvePlatformFeedItems: async () => [
        feedItem({ id: "absolute", href: "https://evil.example/phish" }),
        feedItem({ id: "protocol-relative", href: "//evil.example/phish" }),
        feedItem({
          id: "long",
          title: "t".repeat(200),
          summary: "s".repeat(500),
          badgeLabel: "b".repeat(80),
        }),
      ],
    });

    const items = await resolvePlatformFeedItems(USER);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("long");
    expect(items[0].title).toHaveLength(120);
    expect(items[0].summary).toHaveLength(240);
    expect(items[0].badgeLabel).toHaveLength(40);
  });

  test("resolved items carry ONLY the contract keys", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "test")];
    registerPlugin("test", {
      feedLevel: "member",
      resolvePlatformFeedItems: async () => [
        {
          ...feedItem(),
          studentEmail: "leak@example.com",
          rosterRow: { name: "A Student" },
        } as unknown as PlatformFeedItemInput,
      ],
    });

    const items = await resolvePlatformFeedItems(USER);
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual([
      "badgeLabel",
      "href",
      "id",
      "kind",
      "pinned",
      "publishedAt",
      // Platform-stamped from the viewer's membership, never plugin-supplied.
      "sourceHref",
      "summary",
      "title",
    ]);
    expect(items[0].sourceHref).toBe("/organization/org-0a");
  });

  test("merges pinned first, then newest, respecting per-plugin and total caps", async () => {
    membershipRows = [membership(ORG_A, "member"), membership(ORG_B, "member")];
    installRows = [install(ORG_A, "alpha"), install(ORG_B, "beta")];
    registerPlugin("alpha", {
      feedLevel: "member",
      resolvePlatformFeedItems: async () =>
        Array.from({ length: 8 }, (_, index) =>
          feedItem({
            id: `alpha-${index}`,
            publishedAt: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
          }),
        ),
    });
    registerPlugin("beta", {
      feedLevel: "member",
      resolvePlatformFeedItems: async () => [
        feedItem({
          id: "beta-pinned",
          pinned: true,
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
        feedItem({ id: "beta-new", publishedAt: "2026-08-01T00:00:00.000Z" }),
      ],
    });

    const items = await resolvePlatformFeedItems(USER, { limit: 5 });
    // 5 from alpha (per-plugin cap) + 2 from beta.
    expect(items).toHaveLength(7);
    expect(items[0].id).toBe("beta-pinned");
    expect(items[1].id).toBe("beta-new");
    const timestamps = items
      .slice(1)
      .map((item) => Date.parse(item.publishedAt));
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);

    const capped = await resolvePlatformFeedItems(USER, { limit: 8 });
    expect(capped).toHaveLength(10);
  });
});

describe("resolvePlatformDashboardCards", () => {
  test("gates by role and caps one sanitized card per plugin", async () => {
    membershipRows = [membership(ORG_A, "member"), membership(ORG_B, "member")];
    installRows = [install(ORG_A, "visible"), install(ORG_B, "admin-only")];
    registerPlugin("visible", {
      cardLevel: "member",
      resolvePlatformDashboardCard: async () =>
        dashboardCard({
          stats: [
            { label: "One", value: "1" },
            { label: "Two", value: "2" },
            { label: "Three", value: "3" },
            { label: "Four", value: "4" },
          ],
        }),
    });
    registerPlugin("admin-only", {
      cardLevel: "admin",
      resolvePlatformDashboardCard: async () => dashboardCard(),
    });

    const cards = await resolvePlatformDashboardCards(USER);
    expect(cards).toHaveLength(1);
    expect(cards[0].stats).toHaveLength(3);
  });

  test("drops cards with non-app hrefs and invalid status tones", async () => {
    membershipRows = [membership(ORG_A, "member"), membership(ORG_B, "member")];
    installRows = [install(ORG_A, "bad-href"), install(ORG_B, "bad-tone")];
    registerPlugin("bad-href", {
      cardLevel: "member",
      resolvePlatformDashboardCard: async () =>
        dashboardCard({ href: "https://evil.example" }),
    });
    registerPlugin("bad-tone", {
      cardLevel: "member",
      resolvePlatformDashboardCard: async () =>
        dashboardCard({
          status: {
            label: "??",
            tone: "sparkly",
          } as unknown as PlatformDashboardCard["status"],
        }),
    });

    const cards = await resolvePlatformDashboardCards(USER);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBeNull();
  });

  test("resolved cards carry ONLY the contract keys", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "test")];
    registerPlugin("test", {
      cardLevel: "member",
      resolvePlatformDashboardCard: async () =>
        ({
          ...dashboardCard(),
          internalNotes: "should never surface",
        }) as unknown as PlatformDashboardCard,
    });

    const cards = await resolvePlatformDashboardCards(USER);
    expect(cards).toHaveLength(1);
    expect(Object.keys(cards[0]).sort()).toEqual([
      "href",
      "stats",
      "status",
      "title",
    ]);
    expect(Object.keys(cards[0].stats[0]).sort()).toEqual(["label", "value"]);
  });

  test("a rejecting card resolver is isolated and warned once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      membershipRows = [
        membership(ORG_A, "member"),
        membership(ORG_B, "member"),
      ];
      installRows = [install(ORG_A, "throws"), install(ORG_B, "works")];
      registerPlugin("throws", {
        cardLevel: "member",
        resolvePlatformDashboardCard: async () => {
          throw new Error("boom");
        },
      });
      registerPlugin("works", {
        cardLevel: "member",
        resolvePlatformDashboardCard: async () => dashboardCard(),
      });

      const cards = await resolvePlatformDashboardCards(USER);
      expect(cards).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Display preference. The point of the gate is that a hidden plugin costs
// nothing, so every assertion here checks the resolver was never invoked —
// not merely that its output was dropped.
// ---------------------------------------------------------------------------

describe("plugin display preference", () => {
  function twoPluginsWithSpies() {
    membershipRows = [membership(ORG_A, "member"), membership(ORG_B, "member")];
    installRows = [install(ORG_A, "alpha"), install(ORG_B, "beta")];
    const invoked = { alpha: 0, beta: 0 };
    registerPlugin("alpha", {
      feedLevel: "member",
      cardLevel: "member",
      resolvePlatformFeedItems: async () => {
        invoked.alpha += 1;
        return [feedItem({ id: "alpha-1" })];
      },
      resolvePlatformDashboardCard: async () => {
        invoked.alpha += 1;
        return dashboardCard({ title: "Alpha" });
      },
    });
    registerPlugin("beta", {
      feedLevel: "member",
      cardLevel: "member",
      resolvePlatformFeedItems: async () => {
        invoked.beta += 1;
        return [feedItem({ id: "beta-1" })];
      },
      resolvePlatformDashboardCard: async () => {
        invoked.beta += 1;
        return dashboardCard({ title: "Beta" });
      },
    });
    return invoked;
  }

  test("no stored row shows content on both surfaces", async () => {
    const invoked = twoPluginsWithSpies();
    preferenceRows = [];

    expect(await resolvePlatformFeedItems(USER)).toHaveLength(2);
    expect(await resolvePlatformDashboardCards(USER)).toHaveLength(2);
    expect(invoked.alpha).toBe(2);
    expect(invoked.beta).toBe(2);
  });

  test("global off hides everything and runs no resolver", async () => {
    const invoked = twoPluginsWithSpies();
    preferenceRows = [{ show_plugin_content: false, hidden_plugin_keys: [] }];

    expect(await resolvePlatformFeedItems(USER)).toEqual([]);
    expect(await resolvePlatformDashboardCards(USER)).toEqual([]);
    expect(invoked).toEqual({ alpha: 0, beta: 0 });
  });

  test("a per-plugin opt-out hides only that plugin", async () => {
    const invoked = twoPluginsWithSpies();
    preferenceRows = [
      { show_plugin_content: true, hidden_plugin_keys: ["alpha"] },
    ];

    const items = await resolvePlatformFeedItems(USER);
    expect(items.map((item) => item.id)).toEqual(["beta-1"]);

    const cards = await resolvePlatformDashboardCards(USER);
    expect(cards.map((card) => card.title)).toEqual(["Beta"]);

    expect(invoked.alpha).toBe(0);
    expect(invoked.beta).toBe(2);
  });

  test("an unreadable preference hides content rather than overriding an opt-out", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const invoked = twoPluginsWithSpies();
      preferenceRows = [];
      failPreferenceRead = true;

      expect(await resolvePlatformFeedItems(USER)).toEqual([]);
      expect(invoked).toEqual({ alpha: 0, beta: 0 });
    } finally {
      failPreferenceRead = false;
      warn.mockRestore();
    }
  });
});

describe("listPlatformPluginSources", () => {
  test("lists the plugins the viewer could see, hidden ones included", async () => {
    twoPluginsWithSources();
    preferenceRows = [
      { show_plugin_content: false, hidden_plugin_keys: ["alpha"] },
    ];

    const sources = await listPlatformPluginSources(USER);
    expect(sources.map((source) => source.pluginKey)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(sources[0].organizationNames).toEqual(["Org 0a"]);
  });

  test("skips plugins that declare a surface but implement no resolver", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "declares-only")];
    registerPlugin("declares-only", {
      feedLevel: "member",
      cardLevel: "member",
    });

    expect(await listPlatformPluginSources(USER)).toEqual([]);
    expect(await resolvePlatformFeedItems(USER)).toEqual([]);
  });

  test("skips plugins the viewer's role cannot see", async () => {
    membershipRows = [membership(ORG_A, "member")];
    installRows = [install(ORG_A, "admin-only")];
    registerPlugin("admin-only", {
      feedLevel: "admin",
      resolvePlatformFeedItems: async () => [feedItem()],
    });

    expect(await listPlatformPluginSources(USER)).toEqual([]);
  });

  function twoPluginsWithSources() {
    membershipRows = [membership(ORG_A, "member"), membership(ORG_B, "member")];
    installRows = [install(ORG_A, "alpha"), install(ORG_B, "beta")];
    registerPlugin("alpha", {
      feedLevel: "member",
      resolvePlatformFeedItems: async () => [feedItem()],
    });
    registerPlugin("beta", {
      cardLevel: "member",
      resolvePlatformDashboardCard: async () => dashboardCard(),
    });
  }
});
