/**
 * How a plugin's code reaches production.
 *
 * The profile is not cosmetic metadata: it determines what a release digest
 * must cover, whether a deployment record can be trusted, and which host
 * modules the plugin is allowed to compile against.
 */

export type PluginRuntimeProfile = "embedded" | "application" | "service";

export const PLUGIN_RUNTIME_PROFILES: readonly PluginRuntimeProfile[] = [
  "embedded",
  "application",
  "service",
] as const;

/**
 * Compiled into the host build. Its deployment is the host's deployment, so it
 * ships only when the platform ships.
 */
export interface EmbeddedRuntimeAdapterConfig {
  profile: "embedded";
}

/**
 * A separately deployed application that owns a path family under the main
 * domain. `directAccessProtection` is required rather than optional because the
 * child's own domain bypasses the host's request chain entirely; without
 * protection on that domain the host's authorization is decorative.
 */
export interface ApplicationRuntimeAdapterConfig {
  profile: "application";
  /** Path family the child owns, e.g. `/organization/:id/plugins/dvhs-csf`. */
  pathPrefix: string;
  directAccessProtection: "required";
}

/**
 * API-only work: importers, webhooks, scheduled jobs. It serves no host UI.
 */
export interface ServiceRuntimeAdapterConfig {
  profile: "service";
  endpoints: PluginServiceEndpoint[];
}

export interface PluginServiceEndpoint {
  key: string;
  /** Absolute URL or a host-relative path the platform will call. */
  target: string;
  auth: "service-role-jwt" | "oidc" | "shared-secret";
}

export type PluginRuntimeAdapterConfig =
  | EmbeddedRuntimeAdapterConfig
  | ApplicationRuntimeAdapterConfig
  | ServiceRuntimeAdapterConfig;

export function runtimeProfileOf(
  adapter: PluginRuntimeAdapterConfig,
): PluginRuntimeProfile {
  return adapter.profile;
}

/**
 * Whether the profile's deployed program is fully described by the plugin's own
 * source subtree.
 *
 * Only `embedded` is: the host build supplies everything else. An `application`
 * or `service` release also carries its own app sources and dependency lock, so
 * a digest over the plugin subtree alone would not identify the code that ran.
 * Release identity uses this to decide whether build and SBOM digests are
 * mandatory.
 */
export function profileRequiresBuildProvenance(
  profile: PluginRuntimeProfile,
): boolean {
  return profile !== "embedded";
}
