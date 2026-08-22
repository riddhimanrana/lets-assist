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
import {
  getPublishedPluginRelease,
  type PublishedPluginRelease,
} from "@/lib/plugins/published-releases";

const EMBEDDED_PLUGIN_KEYS = ["dvhs-csf", "dv-speech-debate"] as const;
const PLUGIN_DATA_SCHEMA_FLOOR = "20260412000001";

/**
 * Bootstrap releases predate signing, so their missing provenance stays null
 * in the publication registry. These host-owned values describe only how the
 * already embedded code adopted the SDK. The first signed release replaces
 * every field here with its verified release contract.
 */
const legacyEmbeddedPluginAdoptions: Record<string, EmbeddedPluginAdoption> = {
  "dvhs-csf": {
    hostApiRange: { minimum: PLUGIN_HOST_API_VERSION },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: PLUGIN_DATA_SCHEMA_FLOOR,
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

export function currentHostSupports(range: PluginHostApiRange): boolean {
  return (
    comparePluginVersions(PLUGIN_HOST_API_VERSION, range.minimum) >= 0 &&
    (range.maximum === undefined ||
      comparePluginVersions(PLUGIN_HOST_API_VERSION, range.maximum) <= 0)
  );
}

export function adoptionFromPublishedRelease(
  pluginKey: string,
  release: PublishedPluginRelease,
  legacyAdoption?: EmbeddedPluginAdoption,
): EmbeddedPluginAdoption {
  if (release.runtimeProfile !== "embedded") {
    throw new Error(
      `Plugin "${pluginKey}" is embedded but its published release uses the "${release.runtimeProfile}" runtime.`,
    );
  }
  if (!release.signer) {
    if (!legacyAdoption) {
      throw new Error(
        `Unsigned bootstrap release "${pluginKey}" has no legacy SDK adoption.`,
      );
    }
    if (!currentHostSupports(legacyAdoption.hostApiRange)) {
      throw new Error(
        `Plugin "${pluginKey}" does not support host API ${PLUGIN_HOST_API_VERSION}.`,
      );
    }
    return legacyAdoption;
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

function adoptionFromRelease(pluginKey: string): EmbeddedPluginAdoption {
  const release = getPublishedPluginRelease(pluginKey, "embedded");
  if (!release) {
    throw new Error(
      `Plugin "${pluginKey}" declares an SDK adoption but has no published release.`,
    );
  }
  return adoptionFromPublishedRelease(
    pluginKey,
    release,
    legacyEmbeddedPluginAdoptions[pluginKey],
  );
}

/**
 * Signed releases own every release field used by both the embedded SDK package
 * and runtime authorization. Unsigned bootstrap releases use the explicit
 * host-owned adoption above without changing their recorded provenance.
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
