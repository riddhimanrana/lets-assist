import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("organization settings action modules", () => {
  test("the compatibility barrel preserves organization and plugin actions", () => {
    const barrel = read("app/organization/[id]/settings/actions.ts");
    for (const actionName of [
      "checkUsernameAvailability",
      "deleteOrganization",
      "generateStaffLink",
      "getOrganizationPluginSettings",
      "getStaffLinkDetails",
      "permanentlyDeleteOrganizationPluginData",
      "revokeStaffLink",
      "setOrganizationPluginApplicationRuntime",
      "setOrganizationPluginInstallState",
      "uninstallOrganizationPlugin",
      "updateOrganization",
      "updateOrganizationPluginConfiguration",
      "updateOrganizationPluginToLatest",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("all focused action modules meet the service budget", () => {
    for (const path of [
      "app/organization/[id]/settings/server/profile.ts",
      "app/organization/[id]/settings/server/plugin-query.ts",
      "app/organization/[id]/settings/server/plugin-mutations.ts",
      "app/organization/[id]/settings/server/plugin-data-deletion-mutation.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });

  test("application runtime changes keep retry identity and selected version distinct", () => {
    const component = read(
      "app/organization/[id]/settings/OrganizationPluginSettings.tsx",
    );
    const mutations = read(
      "app/organization/[id]/settings/server/plugin-mutations.ts",
    );
    const query = read("app/organization/[id]/settings/server/plugin-query.ts");

    expect(component).toContain(
      "applicationRuntimeRequestIds.current.get(requestKey)",
    );
    expect(component).toContain("requestId,");
    expect(mutations).toContain("p_request_id: requestId");
    expect(mutations).not.toContain("p_request_id: crypto.randomUUID()");
    expect(query).toContain("selectedApplicationVersion");
    expect(query).toContain("selectedDeploymentHealthy");
    expect(query).toContain("availableVersion: status.applicationVersion");
  });
});
