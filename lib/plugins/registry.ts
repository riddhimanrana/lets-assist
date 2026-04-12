import type { OrganizationPluginDefinition } from "@/types";

function loadPrivatePlugins(): OrganizationPluginDefinition[] {
  try {
    // The private plugin registry is provided via a private git submodule.
    // In CI (and some local setups) that submodule is intentionally absent.
    // Using `require` here avoids TypeScript hard-failing on a missing module
    // during `tsc --noEmit`, while still allowing builds to include private
    // plugins when the submodule is present.
    const mod = require("./private/registry") as {
      privatePlugins?: OrganizationPluginDefinition[];
    };

    return Array.isArray(mod.privatePlugins) ? mod.privatePlugins : [];
  } catch {
    return [];
  }
}

const pluginDefinitions: OrganizationPluginDefinition[] = [
  // Custom / Monetized plugins loaded securely via private submodules/folders:
  ...loadPrivatePlugins(),
];

export function createPluginRegistry(
  definitions: OrganizationPluginDefinition[],
  allowList: Set<string> | null,
): Map<string, OrganizationPluginDefinition> {
  const registry = new Map<string, OrganizationPluginDefinition>();

  for (const definition of definitions) {
    const key = definition.manifest.key;
    if (!key) {
      throw new Error("Plugin manifest key is required");
    }

    if (allowList && !allowList.has(key)) {
      continue;
    }

    if (registry.has(key)) {
      throw new Error(`Duplicate plugin key detected: ${key}`);
    }

    registry.set(key, definition);
  }

  return registry;
}

const registry = createPluginRegistry(pluginDefinitions, null);

export function getRegisteredPlugin(
  key: string,
): OrganizationPluginDefinition | undefined {
  return registry.get(key);
}

export function listRegisteredPlugins(): OrganizationPluginDefinition[] {
  return [...registry.values()].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );
}