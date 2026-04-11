import {
  OrganizationPluginDefinition,
  OrganizationPluginLifecycleContext,
  OrganizationPluginLifecycleHooks,
} from "@/types/plugin";
import { logPluginAudit, withPluginExecution } from "./audit";

// Re-export the types for convenience
export type { OrganizationPluginLifecycleContext, OrganizationPluginLifecycleHooks };

function getLifecycleActionName(
  hookName: keyof OrganizationPluginLifecycleHooks,
): "lifecycle.install" | "lifecycle.uninstall" | "lifecycle.enable" | "lifecycle.disable" | "lifecycle.config_update" | "lifecycle.version_update" {
  switch (hookName) {
    case "onInstall":
      return "lifecycle.install";
    case "onUninstall":
      return "lifecycle.uninstall";
    case "onEnable":
      return "lifecycle.enable";
    case "onDisable":
      return "lifecycle.disable";
    case "onConfigUpdate":
      return "lifecycle.config_update";
    case "onVersionUpdate":
      return "lifecycle.version_update";
  }
}

/**
 * Execute a lifecycle hook with proper error handling, logging, and metrics
 */
export async function executeLifecycleHook<K extends keyof OrganizationPluginLifecycleHooks>(
  plugin: OrganizationPluginDefinition,
  hookName: K,
  context: OrganizationPluginLifecycleContext,
): Promise<{ success: boolean; error?: string }> {
  const hook = plugin.lifecycle?.[hookName];

  if (!hook) {
    return { success: true }; // No hook defined, that's fine
  }

  try {
    await withPluginExecution(
      context.organization.id,
      context.pluginKey,
      "behavior",
      async () => {
        await hook(context as never);
      },
    );

    // Log successful lifecycle event
    await logPluginAudit({
      organization_id: context.organization.id,
      plugin_key: context.pluginKey,
      action: getLifecycleActionName(hookName as keyof OrganizationPluginLifecycleHooks),
      actor_id: context.actor?.id,
      actor_type: context.actor?.type ?? "system",
      details: {
        hookName,
        success: true,
      },
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `Plugin lifecycle hook ${String(hookName)} failed for ${context.pluginKey}:`,
      error,
    );

    // Log failed lifecycle event
    await logPluginAudit({
      organization_id: context.organization.id,
      plugin_key: context.pluginKey,
      action: getLifecycleActionName(hookName as keyof OrganizationPluginLifecycleHooks),
      actor_id: context.actor?.id,
      actor_type: context.actor?.type ?? "system",
      details: {
        hookName,
        success: false,
        error: errorMessage,
      },
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * Run the install lifecycle for a plugin
 */
export async function runPluginInstall(
  plugin: OrganizationPluginDefinition,
  context: Omit<OrganizationPluginLifecycleContext, "pluginKey">,
): Promise<{ success: boolean; error?: string }> {
  return executeLifecycleHook(plugin, "onInstall", {
    ...context,
    pluginKey: plugin.manifest.key,
  });
}

/**
 * Run the uninstall lifecycle for a plugin
 */
export async function runPluginUninstall(
  plugin: OrganizationPluginDefinition,
  context: Omit<OrganizationPluginLifecycleContext, "pluginKey">,
): Promise<{ success: boolean; error?: string }> {
  return executeLifecycleHook(plugin, "onUninstall", {
    ...context,
    pluginKey: plugin.manifest.key,
  });
}

/**
 * Run the enable lifecycle for a plugin
 */
export async function runPluginEnable(
  plugin: OrganizationPluginDefinition,
  context: Omit<OrganizationPluginLifecycleContext, "pluginKey">,
): Promise<{ success: boolean; error?: string }> {
  return executeLifecycleHook(plugin, "onEnable", {
    ...context,
    pluginKey: plugin.manifest.key,
  });
}

/**
 * Run the disable lifecycle for a plugin
 */
export async function runPluginDisable(
  plugin: OrganizationPluginDefinition,
  context: Omit<OrganizationPluginLifecycleContext, "pluginKey">,
): Promise<{ success: boolean; error?: string }> {
  return executeLifecycleHook(plugin, "onDisable", {
    ...context,
    pluginKey: plugin.manifest.key,
  });
}

/**
 * Run the config update lifecycle for a plugin
 */
export async function runPluginConfigUpdate(
  plugin: OrganizationPluginDefinition,
  context: Omit<OrganizationPluginLifecycleContext, "pluginKey"> & {
    previousConfig: Record<string, unknown>;
  },
): Promise<{ success: boolean; error?: string }> {
  return executeLifecycleHook(plugin, "onConfigUpdate", {
    ...context,
    pluginKey: plugin.manifest.key,
  });
}

/**
 * Validate that a plugin can be safely uninstalled
 * Checks if there's any data that would be orphaned
 */
export async function validatePluginUninstall(
  plugin: OrganizationPluginDefinition,
  _context: Omit<OrganizationPluginLifecycleContext, "pluginKey">,
): Promise<{ canUninstall: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  // If the plugin has custom cleanup, it should handle its own data
  if (plugin.lifecycle?.onUninstall) {
    warnings.push(
      "This plugin has custom data that will be cleaned up during uninstall.",
    );
  }

  // Check manifest for any data dependencies
  if (plugin.manifest.dataScope && plugin.manifest.dataScope.length > 0) {
    warnings.push(
      `This plugin manages data in: ${plugin.manifest.dataScope.join(", ")}. This data may be deleted.`,
    );
  }

  return {
    canUninstall: true, // Currently always allow, but warnings inform the user
    warnings,
  };
}
