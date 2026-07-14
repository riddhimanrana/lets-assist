import { describe, expect, test } from "bun:test";

import {
  filterConsolidatedPluginAccessRows,
  loadAccessibleOrganizationPluginAccess,
  resolveLegacyOrganizationPluginAccess,
  type OrganizationPluginAccessRow,
  type PluginAccessQueryClient,
} from "@/lib/plugins/organization-plugin-access";

const NOW = new Date("2026-07-11T12:00:00.000Z");

function accessRow(
  overrides: Partial<OrganizationPluginAccessRow> = {},
): OrganizationPluginAccessRow {
  return {
    organization_id: "org-1",
    plugin_key: "calendar-tools",
    enabled: true,
    configuration: {},
    installed_at: "2026-01-01T00:00:00.000Z",
    installed_version: "2.0.0",
    visibility: "global",
    is_active: true,
    latest_version: "2.0.0",
    force_update_version: null,
    is_accessible: true,
    ...overrides,
  };
}

type QueryResponse = {
  data: unknown[] | null;
  error: { code?: string; message?: string } | null;
};

function queryClient(
  responses: Record<string, QueryResponse | Error>,
  visited: string[] = [],
): PluginAccessQueryClient {
  return {
    from(table: string) {
      visited.push(table);
      const response = responses[table] ?? {
        data: null,
        error: { message: `Unexpected table: ${table}` },
      };
      const builder = {
        select() {
          return builder;
        },
        in() {
          return builder;
        },
        eq() {
          return builder;
        },
        then<TResult1 = QueryResponse, TResult2 = never>(
          onfulfilled?:
            | ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ) {
          const result =
            response instanceof Error
              ? Promise.reject(response)
              : Promise.resolve(response);
          return result.then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  } as unknown as PluginAccessQueryClient;
}

describe("organization plugin access resolution", () => {
  test("the consolidated read model enforces active, accessible, enabled, and forced-update gates", () => {
    const rows = filterConsolidatedPluginAccessRows([
      accessRow({ plugin_key: "allowed" }),
      accessRow({ plugin_key: "disabled", enabled: false }),
      accessRow({ plugin_key: "inactive", is_active: false }),
      accessRow({ plugin_key: "unentitled", is_accessible: false }),
      accessRow({
        plugin_key: "update-required",
        installed_version: "1.0.0",
        force_update_version: "2.0.0",
      }),
    ]);

    expect(rows.map((row) => row.plugin_key)).toEqual(["allowed"]);
  });

  test("legacy resolution preserves global plugins and requires active private entitlements", () => {
    const catalog = [
      ["free", "global", true, "1.0.0", null],
      ["private-active", "private", true, "1.0.0", null],
      ["private-expired", "private", true, "1.0.0", null],
      ["update-required", "global", true, "2.0.0", "2.0.0"],
      ["inactive", "global", false, "1.0.0", null],
      ["forced", "private", true, "1.0.0", null],
    ].map(([key, visibility, is_active, latest_version, force_update_version]) => ({
      key: key as string,
      visibility: visibility as "global" | "private",
      is_active: is_active as boolean,
      latest_version: latest_version as string,
      force_update_version: force_update_version as string | null,
    }));
    const installs = [
      ["free", "1.0.0"],
      ["private-active", "1.0.0"],
      ["private-expired", "1.0.0"],
      ["update-required", "1.0.0"],
      ["inactive", "1.0.0"],
    ].map(([plugin_key, installed_version]) => ({
      organization_id: "org-1",
      plugin_key,
      enabled: true,
      configuration: {},
      installed_at: "2026-01-01T00:00:00.000Z",
      installed_version,
    }));
    const entitlements = [
      {
        organization_id: "org-1",
        plugin_key: "private-active",
        status: "active" as const,
        starts_at: null,
        ends_at: "2026-08-01T00:00:00.000Z",
        is_forced: false,
      },
      {
        organization_id: "org-1",
        plugin_key: "private-expired",
        status: "active" as const,
        starts_at: null,
        ends_at: "2026-07-01T00:00:00.000Z",
        is_forced: false,
      },
      {
        organization_id: "org-1",
        plugin_key: "forced",
        status: "active" as const,
        starts_at: null,
        ends_at: null,
        is_forced: true,
      },
    ];

    const rows = resolveLegacyOrganizationPluginAccess({
      catalog,
      entitlements,
      installs,
      now: NOW,
    });

    expect(rows.map((row) => row.plugin_key)).toEqual([
      "forced",
      "free",
      "private-active",
    ]);
    expect(rows.find((row) => row.plugin_key === "forced")?.installed_at).toBeNull();
  });

  test("a missing consolidated view uses all three legacy control-plane tables", async () => {
    const visited: string[] = [];
    const rows = await loadAccessibleOrganizationPluginAccess({
      supabase: queryClient(
        {
          organization_plugin_access: {
            data: null,
            error: { code: "PGRST205", message: "schema cache miss" },
          },
          plugins: {
            data: [
              {
                key: "free",
                visibility: "global",
                is_active: true,
                latest_version: "1.0.0",
                force_update_version: null,
              },
            ],
            error: null,
          },
          organization_plugin_entitlements: { data: [], error: null },
          organization_plugin_installs: {
            data: [
              {
                organization_id: "org-1",
                plugin_key: "free",
                enabled: true,
                configuration: {},
                installed_at: null,
                installed_version: "1.0.0",
              },
            ],
            error: null,
          },
        },
        visited,
      ),
      organizationIds: ["org-1"],
      now: NOW,
    });

    expect(rows.map((row) => row.plugin_key)).toEqual(["free"]);
    expect(visited.sort()).toEqual([
      "organization_plugin_access",
      "organization_plugin_entitlements",
      "organization_plugin_installs",
      "plugins",
    ]);
  });

  test("unknown view errors and partial legacy reads fail closed", async () => {
    const unknownErrorVisited: string[] = [];
    const unknownErrorRows = await loadAccessibleOrganizationPluginAccess({
      supabase: queryClient(
        {
          organization_plugin_access: {
            data: null,
            error: { code: "500", message: "network uncertainty" },
          },
        },
        unknownErrorVisited,
      ),
      organizationIds: ["org-1"],
    });

    expect(unknownErrorRows).toEqual([]);
    expect(unknownErrorVisited).toEqual(["organization_plugin_access"]);

    const partialRows = await loadAccessibleOrganizationPluginAccess({
      supabase: queryClient({
        organization_plugin_access: {
          data: null,
          error: { code: "42P01", message: "view missing" },
        },
        plugins: { data: [], error: null },
        organization_plugin_entitlements: {
          data: null,
          error: { message: "entitlement query failed" },
        },
        organization_plugin_installs: {
          data: [accessRow({ plugin_key: "must-not-leak" })],
          error: null,
        },
      }),
      organizationIds: ["org-1"],
    });

    expect(partialRows).toEqual([]);
  });

  test("thrown query failures fail closed", async () => {
    const rows = await loadAccessibleOrganizationPluginAccess({
      supabase: queryClient({
        organization_plugin_access: new Error("fetch failed"),
      }),
      organizationIds: ["org-1"],
    });

    expect(rows).toEqual([]);
  });
});
