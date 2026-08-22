/**
 * The embedded runtime adapter.
 *
 * An embedded plugin is compiled into the host build, so its definition can
 * carry things no wire format could: React renderers, in-process lifecycle
 * functions, host types. That richness is not a problem to be removed — it is
 * what makes embedded plugins cheap. The problem is that it was also the
 * *only* description of a plugin, which left nothing for a separately deployed
 * plugin to state about itself.
 *
 * This adapter derives the serializable manifest from an existing embedded
 * definition, so both runtime profiles are described by one document while the
 * embedded definition keeps its renderers. Deriving rather than requiring means
 * the two private plugins adopt the contract with no changes in the private
 * repository; explicit SDK manifests there become a later mechanical step.
 */

import type { OrganizationPluginDefinition } from "@/types";

import {
  PLUGIN_SDK_VERSION,
  type PluginSdkManifest,
} from "@/lib/plugins/sdk/v1/manifest";
import type { PluginInstallContractRange } from "@/lib/plugins/sdk/v1/compatibility";
import type { PluginHostApiRange } from "@/lib/plugins/sdk/v1/release";
import { validatePluginSdkManifest } from "@/lib/plugins/sdk/v1/schema";

/**
 * The facts an embedded definition cannot supply because they are release and
 * compatibility metadata rather than implementation detail. Kept in the host so
 * adopting the contract requires no private-repository change.
 */
export interface EmbeddedPluginAdoption {
  hostApiRange: PluginHostApiRange;
  pluginDataSchemaVersion: number;
  requiredPlatformSchemaVersion: string;
  /**
   * Versions of this plugin whose behavior the deployed code can serve.
   *
   * Adoption starts at exactly the manifest version, which reproduces the
   * previous exact-match runtime gate byte for byte. Widening it is a per-release
   * decision made when a rollout actually needs to serve two contracts, not a
   * default.
   */
  supportedInstallContracts: PluginInstallContractRange;
  /** Source subtrees whose bytes constitute a release of this plugin. */
  releaseInputs: string[];
}

export interface EmbeddedPluginPackage {
  sdk: PluginSdkManifest;
  /** Unchanged: renderers and in-process lifecycle hooks stay host-typed. */
  definition: OrganizationPluginDefinition;
}

export class EmbeddedPluginAdoptionError extends Error {
  constructor(
    readonly pluginKey: string,
    readonly problems: string[],
  ) {
    super(
      `Plugin "${pluginKey}" does not satisfy the plugin SDK contract:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "EmbeddedPluginAdoptionError";
  }
}

/**
 * Project an embedded manifest onto the serializable contract.
 *
 * Only fields that already exist as plain data are carried across. Renderers,
 * behavior hooks, and platform surface bindings stay on the embedded definition
 * because they are in-process bindings with no wire representation.
 */
export function toSdkManifest(
  definition: OrganizationPluginDefinition,
  adoption: EmbeddedPluginAdoption,
): PluginSdkManifest {
  const manifest = definition.manifest;

  return {
    sdkVersion: PLUGIN_SDK_VERSION,
    key: manifest.key,
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    version: manifest.version,
    visibility: manifest.visibility,
    ...(manifest.minimumRole ? { minimumRole: manifest.minimumRole } : {}),

    runtime: { profile: "embedded" },

    hostApiRange: adoption.hostApiRange,
    pluginDataSchemaVersion: adoption.pluginDataSchemaVersion,
    requiredPlatformSchemaVersion: adoption.requiredPlatformSchemaVersion,
    supportedInstallContracts: adoption.supportedInstallContracts,
    releaseInputs: adoption.releaseInputs,

    ...(manifest.routes ? { routes: manifest.routes } : {}),
    ...(manifest.navLabel || manifest.organizationPageChrome
      ? {
          navigation: {
            ...(manifest.navLabel ? { navLabel: manifest.navLabel } : {}),
            ...(manifest.organizationPageChrome
              ? { organizationPageChrome: manifest.organizationPageChrome }
              : {}),
          },
        }
      : {}),
    ...(manifest.backendCapabilities
      ? { capabilities: manifest.backendCapabilities }
      : {}),
    ...(manifest.requiredScopes
      ? { requiredScopes: [...manifest.requiredScopes] }
      : {}),
    ...(manifest.configSchema ? { configSchema: manifest.configSchema } : {}),

    dataIsolation: "shared",
    ...(manifest.dataAccess ? { dataAccess: manifest.dataAccess } : {}),
    ...(manifest.storageAccess
      ? { storageAccess: manifest.storageAccess }
      : {}),
    ...(manifest.dataDeletion ? { dataDeletion: manifest.dataDeletion } : {}),
  } as PluginSdkManifest;
}

/**
 * Derive and validate, or refuse.
 *
 * Failing here fails at module load, which takes the whole application down
 * rather than serving a plugin whose contract does not hold. That is deliberate
 * and matches the existing duplicate-key behavior: a plugin whose declared
 * contract is wrong is exactly the case where continuing would let the platform
 * make authorization and release decisions on false premises.
 */
export function adoptEmbeddedPlugin(
  definition: OrganizationPluginDefinition,
  adoption: EmbeddedPluginAdoption,
): EmbeddedPluginPackage {
  const sdk = toSdkManifest(definition, adoption);
  const result = validatePluginSdkManifest(sdk);

  if (!result.valid) {
    throw new EmbeddedPluginAdoptionError(
      definition.manifest.key,
      result.errors.map((error) => `${error.path} ${error.message}`),
    );
  }

  if (sdk.version !== definition.manifest.version) {
    throw new EmbeddedPluginAdoptionError(definition.manifest.key, [
      `derived version ${sdk.version} does not match manifest version ${definition.manifest.version}`,
    ]);
  }

  return { sdk, definition };
}
