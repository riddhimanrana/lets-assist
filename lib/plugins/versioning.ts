/**
 * Host-facing plugin version helpers.
 *
 * The arithmetic lives in the SDK (`lib/plugins/sdk/v1/compatibility`) rather
 * than here, because plugins that deploy separately need the same comparison
 * rules. Two implementations drifting apart would mean a plugin and the host
 * disagreeing about whether a release is compatible, which is the exact failure
 * the compatibility contract exists to prevent. This module stays as the host's
 * import surface so existing call sites are unaffected.
 */

import {
  comparePluginVersions,
  normalizePluginVersion,
} from "@/lib/plugins/sdk/v1/compatibility";

export {
  comparePluginVersions,
  isPluginVersionBehind,
  isPluginVersionWithinContractRange,
  type PluginInstallContractRange,
} from "@/lib/plugins/sdk/v1/compatibility";

/**
 * Exact-match runtime gate.
 *
 * Retained for the call sites that have not yet moved to install-contract
 * ranges. Exact matching makes any staged rollout impossible: the moment a new
 * version deploys, every organization still on the previous one loses the
 * plugin until an administrator acts.
 */
export function isPluginRuntimeVersionExact(
  installed: string | null | undefined,
  loaded: string | null | undefined,
): boolean {
  return comparePluginVersions(installed, loaded) === 0;
}

export function coalescePluginVersion(
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const normalizedPrimary = normalizePluginVersion(primary);
  if (normalizedPrimary && normalizedPrimary !== "0.0.0") {
    return normalizedPrimary;
  }

  const normalizedFallback = normalizePluginVersion(fallback);
  return normalizedFallback || "0.0.0";
}
