/**
 * How each embedded plugin adopts the SDK contract.
 *
 * These are release and compatibility facts, not implementation detail, so they
 * live in the host rather than in the private repository. Keeping them here is
 * what lets both private plugins satisfy the generic contract without a single
 * change on the private side; explicit SDK manifests there become a later
 * mechanical step.
 */

import { comparePluginVersions } from "@/lib/plugins/sdk/v1/compatibility";
import type { PluginHostApiRange } from "@/lib/plugins/sdk/v1/release";
import type { EmbeddedPluginAdoption } from "@/lib/plugins/sdk/adapters/embedded";
import { PLUGIN_HOST_API_VERSION } from "@/lib/plugins/sdk/host-api-version";
import { getPublishedPluginRelease } from "@/lib/plugins/published-releases";

const EMBEDDED_PLUGIN_KEYS = ["dvhs-csf", "dv-speech-debate"] as const;

export function currentHostSupports(range: PluginHostApiRange): boolean {
  return (
    comparePluginVersions(PLUGIN_HOST_API_VERSION, range.minimum) >= 0 &&
    (range.maximum === undefined ||
      comparePluginVersions(PLUGIN_HOST_API_VERSION, range.maximum) <= 0)
  );
}

function adoptionFromRelease(pluginKey: string): EmbeddedPluginAdoption {
  const release = getPublishedPluginRelease(pluginKey);
  if (!release) {
    throw new Error(
      `Plugin "${pluginKey}" declares an SDK adoption but has no published release.`,
    );
  }
  if (release.runtimeProfile !== "embedded") {
    throw new Error(
      `Plugin "${pluginKey}" is embedded but its published release uses the "${release.runtimeProfile}" runtime.`,
    );
  }
  if (!release.releaseInputs) {
    throw new Error(
      `Embedded plugin "${pluginKey}" has no signed release input contract.`,
    );
  }
  if (!currentHostSupports(release.hostApiRange)) {
    throw new Error(
      `Plugin "${pluginKey}" does not support host API ${PLUGIN_HOST_API_VERSION}.`,
    );
  }

  return {
    hostApiRange: release.hostApiRange,
    pluginDataSchemaVersion: release.pluginDataSchemaVersion,
    requiredPlatformSchemaVersion: release.requiredPlatformSchemaVersion,
    supportedInstallContracts: release.supportedInstallContracts,
    releaseInputs: release.releaseInputs,
  };
}

/**
 * The signed release registry owns the install range used by both the embedded
 * SDK package and runtime authorization. A release integration updates that
 * registry in one place, so the compiled package cannot keep an older range.
 */
export const embeddedPluginAdoptions: Record<string, EmbeddedPluginAdoption> =
  Object.fromEntries(
    EMBEDDED_PLUGIN_KEYS.map((pluginKey) => [
      pluginKey,
      adoptionFromRelease(pluginKey),
    ]),
  );

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
