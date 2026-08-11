import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("admin plugin control-plane modules", () => {
  test("the compatibility barrel preserves the control-plane surface", () => {
    const barrel = read("app/admin/plugins/actions.ts");
    for (const actionName of [
      "bulkUpsertOrganizationPluginEntitlements",
      "forceInstallOrganizationPlugin",
      "forceUpdateOrganizationPluginInstall",
      "getPluginControlPlaneData",
      "setOrganizationPluginInstallStateByAdmin",
      "upsertOrganizationPluginEntitlement",
      "upsertOrganizationPluginInstallConfiguration",
      "upsertPluginCatalogControl",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("all focused action modules meet the service budget", () => {
    for (const path of [
      "app/admin/plugins/server/query.ts",
      "app/admin/plugins/server/catalog-entitlements.ts",
      "app/admin/plugins/server/installs.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
