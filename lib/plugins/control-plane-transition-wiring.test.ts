import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readProjectActionSource } from "@/tests/support/project-action-source";

const root = join(import.meta.dir, "../..");

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

function exportedFunctionSource(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("plugin control-plane action wiring", () => {
  const organizationActions = read("app/organization/[id]/settings/actions.ts");
  const organizationPluginSettings = read(
    "app/organization/[id]/settings/OrganizationPluginSettings.tsx",
  );
  const adminActions = read("app/admin/plugins/actions.ts");
  const transitionAdapter = read("lib/plugins/control-plane-transition.ts");
  const transitionLockMigration = read(
    "supabase/migrations/20260712012500_serialize_plugin_control_plane_transitions.sql",
  );
  const directInstallMutation =
    /\.from\(["']organization_plugin_installs["']\)[\s\S]*?\.(?:insert|upsert|update|delete)\(/;

  for (const name of [
    "setOrganizationPluginInstallState",
    "uninstallOrganizationPlugin",
    "updateOrganizationPluginToLatest",
    "updateOrganizationPluginConfiguration",
  ]) {
    test(`organization action ${name} uses the shared transition boundary`, () => {
      const source = exportedFunctionSource(organizationActions, name);
      expect(source).toContain("transitionOrganizationPluginInstall({");
      expect(source).not.toMatch(directInstallMutation);
    });
  }

  for (const name of [
    "forceUpdateOrganizationPluginInstall",
    "forceInstallOrganizationPlugin",
    "setOrganizationPluginInstallStateByAdmin",
    "upsertOrganizationPluginInstallConfiguration",
  ]) {
    test(`admin action ${name} uses the shared transition boundary`, () => {
      const source = exportedFunctionSource(adminActions, name);
      expect(source).toContain(
        name === "setOrganizationPluginInstallStateByAdmin"
          ? "forceInstallOrganizationPlugin({"
          : "transitionOrganizationPluginInstall({",
      );
      expect(source).not.toMatch(directInstallMutation);
    });
  }

  test("admin configuration validates the registered manifest and cannot create a phantom install", () => {
    const source = exportedFunctionSource(
      adminActions,
      "upsertOrganizationPluginInstallConfiguration",
    );
    expect(source).toContain("getRegisteredPlugin(input.pluginKey)");
    expect(source).toContain("validatePluginConfig(");
    expect(source).toContain(
      "Install the plugin before updating its configuration.",
    );
    expect(source).not.toContain(
      ".insert({\n        organization_id: input.organizationId",
    );
  });

  test("force install compensates only entitlement access provisioned by that request", () => {
    const source = exportedFunctionSource(
      adminActions,
      "forceInstallOrganizationPlugin",
    );
    expect(source).toContain("existingEntitlement");
    expect(source).toContain('kind: "delete_created"');
    expect(source).toContain('kind: "restore_reactivated"');
    expect(source).toContain("if (!transitionResult.success)");
    expect(source).toContain(
      '.eq("updated_at", entitlementCompensation.activationUpdatedAt)',
    );
    expect(source).toContain("Private entitlement rollback also failed");
    expect(source).not.toContain(".upsert(");
  });

  test("project creation and signup lifecycle integrations remain wired", () => {
    const projectCreate = read("app/projects/create/actions.ts");
    const projectActions = readProjectActionSource(root);
    expect(projectCreate).toContain("runProjectCreate(plugin, {");
    expect(projectActions).toContain("runPluginOnSignup(definition, {");
  });

  test("plugin permission confirmation remains reachable within the viewport", () => {
    expect(organizationPluginSettings).toContain(
      "max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto",
    );
    expect(organizationPluginSettings).toContain(
      "max-h-64 flex-col gap-3 overflow-y-auto",
    );
    expect(organizationPluginSettings).not.toContain(
      'className="sm:max-w-md gap-0 p-0 overflow-hidden"',
    );
  });

  test("control-plane hooks are serialized by a service-role transition lease", () => {
    expect(transitionAdapter).toContain(
      '"acquire_plugin_control_plane_transition_lock"',
    );
    expect(transitionAdapter).toContain(
      '"refresh_plugin_control_plane_transition_lock"',
    );
    expect(transitionAdapter).toContain(
      '"release_plugin_control_plane_transition_lock"',
    );
    expect(
      transitionAdapter.indexOf("acquire_plugin_control_plane_transition_lock"),
    ).toBeLessThan(
      transitionAdapter.indexOf(
        "return await transitionOrganizationPluginInstallWithLease(",
      ),
    );

    expect(transitionLockMigration).toContain(
      "private.plugin_control_plane_transition_locks",
    );
    expect(transitionLockMigration).toContain("security definer");
    expect(transitionLockMigration).toContain("to service_role;");
    expect(transitionLockMigration).toContain(
      "from public, anon, authenticated;",
    );
  });

  test("the server-only marker is a pinned runtime dependency", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["server-only"]).toBe("0.0.1");
  });
});
