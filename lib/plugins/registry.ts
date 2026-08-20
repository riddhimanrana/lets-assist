import type { OrganizationPluginDefinition } from "@/types";

import { adoptionFor } from "./sdk-adoption";
import {
  adoptEmbeddedPlugin,
  type EmbeddedPluginPackage,
} from "./sdk/adapters/embedded";
import { privatePlugins } from "./private/registry";

const pluginDefinitions: OrganizationPluginDefinition[] = [
  // Custom / Monetized plugins loaded securely via private submodules/folders:
  ...privatePlugins,
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

/**
 * Derive and validate every registered plugin's serializable contract.
 *
 * Runs at module load, alongside the existing duplicate-key check, and throws
 * on failure. A plugin whose declared contract is invalid is exactly the case
 * where continuing would let the platform make authorization and release
 * decisions on false premises, so refusing to boot is the safer failure.
 */
function createPluginPackages(
  registry: Map<string, OrganizationPluginDefinition>,
): Map<string, EmbeddedPluginPackage> {
  const packages = new Map<string, EmbeddedPluginPackage>();

  for (const [key, definition] of registry) {
    packages.set(key, adoptEmbeddedPlugin(definition, adoptionFor(key)));
  }

  return packages;
}

const registry = createPluginRegistry(pluginDefinitions, null);
const packages = createPluginPackages(registry);

export function getPluginRegistry() {
  return registry;
}

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

/**
 * The serializable contract plus the embedded implementation. Callers that only
 * need declared metadata should prefer this over the raw definition, because it
 * is the shape a separately deployed plugin can also provide.
 */
export function getRegisteredPluginPackage(
  key: string,
): EmbeddedPluginPackage | undefined {
  return packages.get(key);
}

export function listRegisteredPluginPackages(): EmbeddedPluginPackage[] {
  return [...packages.values()].sort((a, b) =>
    a.sdk.name.localeCompare(b.sdk.name),
  );
}
