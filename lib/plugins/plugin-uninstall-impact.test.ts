import { describe, expect, test } from "bun:test";

import { describePluginUninstallImpact } from "./plugin-uninstall-impact";
import type { OrganizationPluginDefinition } from "@/types/plugin";

function definition(
  overrides?: Partial<OrganizationPluginDefinition["manifest"]>,
): OrganizationPluginDefinition {
  return {
    manifest: {
      key: "example-plugin",
      name: "Example Plugin",
      version: "1.0.0",
      visibility: "global",
      ...overrides,
    },
  } as OrganizationPluginDefinition;
}

describe("describePluginUninstallImpact", () => {
  test("asserts the true contract shape: workflows stop, settings removed, data retained", () => {
    const impact = describePluginUninstallImpact(definition());

    expect(impact.workflowsStop).toBe(true);
    expect(impact.settingsRemoved).toBe(true);
    expect(impact.dataRetained).toBe(true);
  });

  test("never claims plugin_data is deleted or erasable from this screen", () => {
    const impact = describePluginUninstallImpact(definition());

    expect(impact.summary).not.toMatch(/data.{0,40}(deleted|erased|removed)/i);
    expect(impact.summary).toMatch(/not deleted/i);
    expect(impact.summary).toMatch(/no self-service way/i);
  });

  test("states settings removal is real and irreversible", () => {
    const impact = describePluginUninstallImpact(definition());

    expect(impact.summary).toMatch(/removes its saved settings/i);
    expect(impact.summary).toMatch(/cannot be undone/i);
  });

  test("names declared data-access purposes when present", () => {
    const impact = describePluginUninstallImpact(
      definition({
        dataAccess: [
          {
            schema: "plugin_data",
            relation: "org_seasons",
            access: "server-only",
            purpose: "season tracking",
          },
          {
            schema: "plugin_data",
            relation: "org_member_profiles",
            access: "server-only",
            purpose: "member profile extensions",
          },
        ],
      }),
    );

    expect(impact.summary).toContain("season tracking");
    expect(impact.summary).toContain("member profile extensions");
  });

  test("stays truthful with no declared data access, without implying there is none", () => {
    const impact = describePluginUninstallImpact(definition({ dataAccess: [] }));

    expect(impact.summary).toMatch(/any data it already stored/i);
  });
});
