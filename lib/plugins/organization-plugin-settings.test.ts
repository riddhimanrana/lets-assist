import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildOrganizationPluginAdminSettings } =
  await import("./organization-plugin-settings");

const catalog = [
  {
    key: "contract-plugin",
    name: "Contract plugin",
    description: null,
    visibility: "global" as const,
    is_active: true,
    latest_version: "1.1.0",
    force_update_version: null,
    code_repository: null,
    code_reference: null,
    private_codebase: true,
    updated_at: null,
  },
];

const installs = [
  {
    plugin_key: "contract-plugin",
    enabled: true,
    installed_version: "1.0.0",
    configuration: {},
  },
];

function runtimePlugin(version: string) {
  return {
    key: "contract-plugin",
    navLabel: "Contract plugin",
    version,
    supportedInstallContracts: { minimum: "1.0.0", maximum: version },
    minimumRole: "member" as const,
  };
}

describe("organization plugin update deployment truth", () => {
  test("a catalog release is pending while the serving deployment has older code", () => {
    const [plugin] = buildOrganizationPluginAdminSettings({
      catalog,
      entitlements: [],
      installs,
      runtimePlugins: [runtimePlugin("1.0.0")],
    });

    expect(plugin.updateAvailable).toBe(true);
    expect(plugin.availableInRuntime).toBe(true);
    expect(plugin.updateDeployedInRuntime).toBe(false);
  });

  test("an update becomes installable only when the serving runtime matches the target", () => {
    const [plugin] = buildOrganizationPluginAdminSettings({
      catalog,
      entitlements: [],
      installs,
      runtimePlugins: [runtimePlugin("1.1.0")],
    });

    expect(plugin.updateAvailable).toBe(true);
    expect(plugin.updateDeployedInRuntime).toBe(true);
    expect(plugin.blockedReason).toBeNull();
  });
});
