import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readProjectActionSource } from "@/tests/support/project-action-source";
import { readOrganizationSettingsActionSource } from "@/tests/support/organization-settings-action-source";
import { readAdminPluginActionSource } from "@/tests/support/admin-plugin-action-source";
import { readProjectCreateActionSource } from "@/tests/support/project-create-action-source";

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
  const organizationActions = readOrganizationSettingsActionSource();
  const organizationPluginSettings = read(
    "app/organization/[id]/settings/OrganizationPluginSettings.tsx",
  );
  const adminActions = readAdminPluginActionSource();
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
    const projectCreate = readProjectCreateActionSource();
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

  test("install and update transitions reject catalog versions absent from the host runtime", () => {
    expect(transitionAdapter).toContain(
      "targetVersion !== definition.manifest.version",
    );
    expect(transitionAdapter).toContain(
      "The requested embedded plugin version is not loaded in this deployment.",
    );
  });

  test("the server-only marker is a pinned runtime dependency", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["server-only"]).toBe("0.0.1");
  });

  test("uninstallOrganizationPlugin returns an explicit changed discriminator — not derived from message content", () => {
    const source = exportedFunctionSource(
      organizationActions,
      "uninstallOrganizationPlugin",
    );
    // Both the no-op and real-removal paths must carry an explicit changed field.
    expect(source).toContain("changed: false,");
    expect(source).toContain("changed: true,");
    // The return type signature must include changed.
    expect(source).toContain("changed?: boolean");
  });

  test("OrganizationPluginSettings uses response.changed to select the toast title, not message parsing", () => {
    // Real removal → "X uninstalled"; idempotent no-op → "X was already uninstalled".
    expect(organizationPluginSettings).toContain("response.changed === false");
    expect(organizationPluginSettings).toContain("was already uninstalled");
    // Must NOT rely on inspecting the message string to decide the title.
    expect(organizationPluginSettings).not.toMatch(
      /response\.message.*uninstall/i,
    );
  });

  test("uninstall dialog copy does not claim all workflows stop", () => {
    expect(organizationPluginSettings).not.toMatch(
      /all plugin workflows will stop/i,
    );
    expect(organizationPluginSettings).not.toMatch(/stops its workflows/i);
    expect(organizationPluginSettings).toContain(
      "already-queued work may still complete",
    );
  });

  test("plugin-uninstall-impact summary never says all workflows stop", () => {
    const impactSource = read("lib/plugins/plugin-uninstall-impact.ts");
    expect(impactSource).not.toContain("stops its workflows");
    expect(impactSource).not.toContain("All plugin workflows will stop");
    expect(impactSource).toContain("disables plugin surfaces");
    expect(impactSource).toContain("already-queued work may still complete");
  });

  test("erasure copy in plugin-uninstall-impact does not imply a support-triggered request channel when unavailable", () => {
    const impactSource = read("lib/plugins/plugin-uninstall-impact.ts");
    expect(impactSource).not.toContain("authorized request");
    expect(impactSource).toContain(
      "does not currently support an automated, self-service, or support-triggered path",
    );
  });

  test("plugin-uninstall-impact never claims uninstall's own hook is unconstrained by the platform", () => {
    // Ordinary uninstall no longer runs any plugin code at all, so this copy
    // must not resurrect the old "hook runs before removal, unconstrained by
    // the platform" framing that justified treating retention as unprovable.
    const impactSource = read("lib/plugins/plugin-uninstall-impact.ts");
    expect(impactSource).not.toContain("not constrained by the platform");
    expect(impactSource).toContain("does not run any of");
  });

  test("ordinary uninstall never invokes runPluginUninstall or any plugin lifecycle hook", () => {
    const transitionCore = read("lib/plugins/control-plane-transition-core.ts");
    expect(transitionCore).not.toContain("runPluginUninstall(");
    expect(transitionCore).not.toMatch(
      /runLifecycleSequence\(\s*\[\s*\{\s*hook:\s*["']uninstall["']/,
    );
    // The transition adapter and ordinary organization actions must not call
    // the data-deletion hook either — only the dedicated, authorized
    // permanent-deletion service may.
    expect(transitionAdapter).not.toContain("runPluginDataDelete(");
    expect(organizationActions).not.toContain("runPluginDataDelete(");
  });

  test("runPluginDataDelete has exactly one authorized caller: the permanent plugin-data deletion service", () => {
    const lifecycleSource = read("lib/plugins/lifecycle.ts");
    expect(lifecycleSource).toContain(
      "export async function runPluginDataDelete(",
    );
    const deletionService = read("lib/plugins/plugin-data-deletion.ts");
    expect(deletionService).toContain("runPluginDataDelete(");
  });
});
