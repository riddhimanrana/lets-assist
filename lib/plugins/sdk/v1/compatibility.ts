/**
 * Version comparison and install-contract ranges for the plugin SDK.
 *
 * This module owns the semantic-version logic for the whole platform. The
 * host's `lib/plugins/versioning.ts` delegates here rather than keeping a
 * second implementation, because the SDK is designed to be consumed by
 * separately deployed plugins: two copies of this arithmetic drifting apart
 * would mean a plugin and the host disagreeing about whether a release is
 * compatible, which is precisely the failure the contract exists to prevent.
 *
 * Nothing here may import from outside the SDK.
 */

export interface ParsedPluginVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * An inclusive range of plugin versions whose behavior a deployed release can
 * serve. A release that supports only itself declares `{minimum: v, maximum: v}`.
 * A release rolling out N and N-1 widens the minimum.
 */
export interface PluginInstallContractRange {
  minimum: string;
  maximum: string;
}

export function normalizePluginVersion(
  version: string | null | undefined,
): string {
  if (!version) return "0.0.0";
  const trimmed = version.trim().toLowerCase();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

export function parsePluginVersion(
  version: string | null | undefined,
): ParsedPluginVersion {
  const normalized = normalizePluginVersion(version);
  const [majorRaw, minorRaw, patchRaw] = normalized.split(".");

  const major = Number.parseInt(majorRaw ?? "0", 10);
  const minor = Number.parseInt(minorRaw ?? "0", 10);
  // Drop any prerelease or build suffix; ordering across prerelease tags is
  // deliberately not modelled, because no release channel here uses them.
  const patch = Number.parseInt((patchRaw ?? "0").split("-")[0], 10);

  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

export function comparePluginVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const left = parsePluginVersion(a);
  const right = parsePluginVersion(b);

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  return 0;
}

export function isPluginVersionBehind(
  current: string | null | undefined,
  target: string | null | undefined,
): boolean {
  return comparePluginVersions(current, target) < 0;
}

/** A range is only meaningful when its maximum is not below its minimum. */
export function isInstallContractRangeSane(
  range: PluginInstallContractRange | null | undefined,
): boolean {
  if (!range) return false;
  if (!isPluginVersionString(range.minimum)) return false;
  if (!isPluginVersionString(range.maximum)) return false;
  return comparePluginVersions(range.minimum, range.maximum) <= 0;
}

/**
 * Whether a deployed release can serve the behavior an organization has
 * activated. This replaces exact-equality matching, which made any rollout
 * impossible: the moment a new version deployed, every organization still on
 * the previous one lost the plugin until an admin acted.
 *
 * Fails closed. A missing or malformed range matches nothing, so a release
 * that forgot to declare its contract cannot serve anyone.
 */
export function isPluginVersionWithinContractRange(
  installed: string | null | undefined,
  range: PluginInstallContractRange | null | undefined,
): boolean {
  if (!isInstallContractRangeSane(range)) return false;
  if (!installed) return false;

  return (
    comparePluginVersions(installed, range!.minimum) >= 0 &&
    comparePluginVersions(installed, range!.maximum) <= 0
  );
}

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

/**
 * Strict shape check, unlike {@link parsePluginVersion}, which coerces junk to
 * zeroes so runtime comparisons never throw. Release identity and manifest
 * validation use this instead, so a malformed version is rejected at the
 * boundary rather than silently becoming `0.0.0`.
 */
export function isPluginVersionString(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value.trim());
}
