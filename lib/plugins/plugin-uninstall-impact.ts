import type { OrganizationPluginDefinition } from "@/types/plugin";

export type PluginUninstallImpact = {
  /** The install row's `enabled` state stops governing runtime access immediately. */
  workflowsStop: true;
  /** The install row's `configuration` is deleted with it and is not recoverable. */
  settingsRemoved: true;
  /**
   * Uninstall removes only `organization_plugin_installs`. It never touches
   * `plugin_data`, so anything the plugin already wrote there for this
   * organization stays put and is scoped by the same organization_id it was
   * written with.
   */
  dataRetained: true;
  /** Human-readable summary for confirmation dialogs and success messages. */
  summary: string;
};

/**
 * Describe what uninstalling a plugin actually does, for confirmation
 * copy and post-action messaging. This does not run any lifecycle hook and
 * does not touch the database — it states the platform's own contract:
 * `runPluginUninstall`/`removeInstall` (see control-plane-transition-core.ts)
 * only ever delete the install row. Permanent erasure of `plugin_data` is a
 * distinct, currently unwired hook (`onDataDelete` / `runPluginDataDelete`),
 * so this deliberately does not claim a self-service way to request it.
 */
export function describePluginUninstallImpact(
  plugin: OrganizationPluginDefinition,
): PluginUninstallImpact {
  const purposes = (plugin.manifest.dataAccess ?? [])
    .map((entry) => entry.purpose)
    .filter((purpose): purpose is string => Boolean(purpose));

  const retentionClause = purposes.length
    ? `Data it already stored for your organization (${purposes.join("; ")}) is not deleted — it stays scoped to your organization and remains if you reinstall.`
    : "Any data it already stored for your organization is not deleted by uninstalling — it stays scoped to your organization and remains if you reinstall.";

  return {
    workflowsStop: true,
    settingsRemoved: true,
    dataRetained: true,
    summary:
      `Uninstalling ${plugin.manifest.name} stops its workflows and permanently removes its saved settings immediately; that part cannot be undone. ` +
      `${retentionClause} Permanently erasing that retained data is a separate, authorized request — there is currently no self-service way to request it from this screen.`,
  };
}
