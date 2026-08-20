/**
 * How each embedded plugin adopts the SDK contract.
 *
 * These are release and compatibility facts, not implementation detail, so they
 * live in the host rather than in the private repository. Keeping them here is
 * what lets both private plugins satisfy the generic contract without a single
 * change on the private side; explicit SDK manifests there become a later
 * mechanical step.
 */

import type { EmbeddedPluginAdoption } from "@/lib/plugins/sdk/adapters/embedded";
import { PLUGIN_HOST_API_VERSION } from "@/lib/plugins/sdk/host-api-version";

/**
 * The platform migration each plugin's data depends on existing.
 *
 * Both are pinned to the migration that created the plugin data schema rather
 * than to the newest migration: the floor is what the plugin actually requires,
 * and raising it without cause would refuse activation on hosts that can in
 * fact serve the plugin.
 */
const PLUGIN_DATA_SCHEMA_FLOOR = "20260412000001";

export const embeddedPluginAdoptions: Record<string, EmbeddedPluginAdoption> = {
  "dvhs-csf": {
    hostApiRange: { minimum: PLUGIN_HOST_API_VERSION },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: PLUGIN_DATA_SCHEMA_FLOOR,
    // Exactly the current version: this reproduces the previous exact-match
    // runtime gate. Widening is a per-release decision made when a rollout
    // actually needs to serve two contracts.
    supportedInstallContracts: { minimum: "1.1.0", maximum: "1.1.0" },
    releaseInputs: ["plugins/dvhs-csf"],
  },
  "dv-speech-debate": {
    hostApiRange: { minimum: PLUGIN_HOST_API_VERSION },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: PLUGIN_DATA_SCHEMA_FLOOR,
    supportedInstallContracts: { minimum: "2.0.0", maximum: "2.0.0" },
    releaseInputs: ["plugins/dv-speech-debate"],
  },
};

export function adoptionFor(pluginKey: string): EmbeddedPluginAdoption {
  const adoption = embeddedPluginAdoptions[pluginKey];
  if (!adoption) {
    // Fail closed. A registered plugin with no declared compatibility has no
    // basis on which the platform could decide whether it may run.
    throw new Error(
      `Plugin "${pluginKey}" is registered but declares no SDK adoption. Add it to lib/plugins/sdk-adoption.ts.`,
    );
  }
  return adoption;
}
