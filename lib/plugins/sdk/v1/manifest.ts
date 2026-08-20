/**
 * The serializable plugin manifest.
 *
 * This is the whole cross-deployment contract. Everything in it is JSON: no
 * React nodes, server actions, database clients, or host types. An embedded
 * plugin's richer definition (renderers, in-process lifecycle functions) wraps
 * one of these rather than replacing it, so both runtime profiles are described
 * by the same document.
 */

import type {
  PluginAccessRole,
  PluginCapabilityDeclaration,
  PluginConfigSchema,
  PluginConfigVisibility,
  PluginDataAccessDeclaration,
  PluginDataDeletionDeclaration,
  PluginDataIsolationMode,
  PluginRouteDeclaration,
  PluginStorageAccessDeclaration,
  PluginVisibility,
} from "./declarations";
import type { PluginInstallContractRange } from "./compatibility";
import type { PluginHostApiRange, PluginReleaseInputs } from "./release";
import type { PluginRuntimeAdapterConfig } from "./runtime-profile";

export const PLUGIN_SDK_VERSION = 1 as const;

export interface PluginNavigationDeclaration {
  navLabel?: string;
  organizationPageChrome?: "default" | "workspace";
}

export interface PluginSdkManifest {
  sdkVersion: typeof PLUGIN_SDK_VERSION;

  key: string;
  name: string;
  description?: string;
  version: string;
  visibility: PluginVisibility;
  minimumRole?: PluginAccessRole;

  /** How this plugin's code reaches production, and how to reach it. */
  runtime: PluginRuntimeAdapterConfig;

  /**
   * Host API versions this plugin is known to work against. Checked before
   * activation so a release cannot be activated onto a host that no longer
   * offers the surface it was built for.
   */
  hostApiRange: PluginHostApiRange;

  /**
   * Generation of the plugin's own data shape, and the platform migration floor
   * it needs. These are separate because plugin data and platform schema move
   * on independent schedules.
   */
  pluginDataSchemaVersion: number;
  requiredPlatformSchemaVersion: string;

  /**
   * Versions whose behavior a deployment of this release can serve. Declaring
   * `{minimum: v, maximum: v}` means no rollout window; widening the minimum is
   * what allows N and N-1 to coexist during a rollout.
   */
  supportedInstallContracts: PluginInstallContractRange;

  /**
   * Source subtrees whose bytes constitute a release of this plugin. A digest
   * is only an integrity claim about what it covers, so an independently built
   * profile must list its application sources and dependency lock here too.
   */
  releaseInputs: PluginReleaseInputs;

  /**
   * Host modules this plugin compiles against.
   *
   * Declared rather than discovered, because the private repository's CI type
   * checks plugins against the host at its current tip: an undeclared import of
   * a host module that does not exist there yet fails as an opaque module
   * resolution error inside a circular pair of pull requests. Declaring the
   * surface turns that into a named, actionable failure and caps growth.
   */
  hostBuildSurface: string[];

  routes?: PluginRouteDeclaration[];
  navigation?: PluginNavigationDeclaration;
  capabilities?: PluginCapabilityDeclaration[];
  requiredScopes?: string[];

  configSchema?: PluginConfigSchema;
  configVisibility?: PluginConfigVisibility;

  /**
   * Only `shared` is claimable. Dedicated schemas, dedicated projects, and
   * external stores are not offered until runtime code enforces them; claiming
   * an isolation mode the platform does not enforce would be a false assurance.
   */
  dataIsolation: PluginDataIsolationMode;
  dataAccess?: PluginDataAccessDeclaration[];
  storageAccess?: PluginStorageAccessDeclaration[];
  dataDeletion?: PluginDataDeletionDeclaration;
}

/** Buckets a manifest may declare. Anything else is rejected at validation. */
export const PLUGIN_STORAGE_BUCKETS: readonly string[] = [
  "plugins",
  "plugin_form_uploads",
  "csf-private",
] as const;
