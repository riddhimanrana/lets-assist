import type {
  PluginHostApiRange,
  PluginBuildArtifact,
  PluginReleaseInputs,
  PluginReleaseSigner,
} from "./sdk/v1/release";
import {
  comparePluginVersions,
  isInstallContractRangeSane,
  isPluginVersionString,
  type PluginInstallContractRange,
} from "./sdk/v1/compatibility";
import { isCommitSha, isContentDigest } from "./sdk/v1/release";
import {
  PLUGIN_RUNTIME_PROFILES,
  type PluginRuntimeProfile,
} from "./sdk/v1/runtime-profile";
import releaseData from "./published-releases.json";

export type PublishedPluginRelease = {
  pluginKey: string;
  version: string;
  manifestFile: string;
  manifestHash: string;
  sourceCommit: string;
  automaticUpdate: boolean;
  rolloutPercentage: number;
  runtimeProfile: PluginRuntimeProfile;
  sourceTree: string | null;
  contentDigest: string | null;
  releaseInputs: PluginReleaseInputs | null;
  buildDigest: string | null;
  buildArtifact: PluginBuildArtifact | null;
  sbomDigest: string | null;
  signer: PluginReleaseSigner | null;
  hostApiRange: PluginHostApiRange;
  pluginDataSchemaVersion: number;
  requiredPlatformSchemaVersion: string;
  supportedInstallContracts: PluginInstallContractRange;
};

function isBuildArtifact(value: PluginBuildArtifact): boolean {
  const sharedFieldsAreValid =
    typeof value.root === "string" &&
    value.root.length > 0 &&
    typeof value.projectName === "string" &&
    value.projectName.length > 0 &&
    /^prj_[A-Za-z0-9]+$/u.test(value.projectId) &&
    /^team_[A-Za-z0-9]+$/u.test(value.organizationId);
  if (!sharedFieldsAreValid) return false;
  if (value.format === "vercel-prebuilt-v1") {
    return value.name === "plugin-build.tar.gz";
  }
  if (value.format !== "vercel-prebuilt-multi-env-v1") return false;
  return (
    value.artifacts?.development?.name === "plugin-build-development.tar.gz" &&
    isContentDigest(value.artifacts.development.digest) &&
    value.artifacts?.production?.name === "plugin-build-production.tar.gz" &&
    isContentDigest(value.artifacts.production.digest)
  );
}

export function assertPublishedPluginReleases(
  value: unknown,
): asserts value is PublishedPluginRelease[] {
  if (!Array.isArray(value)) {
    throw new Error("Published plugin release data must be an array.");
  }
  const profileKeys = new Set<string>();
  const versionKeys = new Set<string>();
  for (const release of value) {
    if (
      !release ||
      typeof release !== "object" ||
      typeof release.pluginKey !== "string" ||
      !isPluginVersionString(release.version) ||
      typeof release.manifestFile !== "string" ||
      !/^[a-f0-9]{64}$/u.test(release.manifestHash) ||
      !isCommitSha(release.sourceCommit) ||
      release.automaticUpdate !== false ||
      release.rolloutPercentage !== 0 ||
      !PLUGIN_RUNTIME_PROFILES.includes(release.runtimeProfile) ||
      (release.sourceTree !== null && !isCommitSha(release.sourceTree)) ||
      (release.contentDigest !== null &&
        !isContentDigest(release.contentDigest)) ||
      (release.releaseInputs !== null &&
        (!Array.isArray(release.releaseInputs) ||
          release.releaseInputs.some(
            (input: unknown) => typeof input !== "string" || input.length === 0,
          ))) ||
      (release.buildDigest !== null && !isContentDigest(release.buildDigest)) ||
      (release.buildArtifact !== null &&
        !isBuildArtifact(release.buildArtifact)) ||
      (release.sbomDigest !== null && !isContentDigest(release.sbomDigest)) ||
      (release.signer !== null &&
        (typeof release.signer?.identity !== "string" ||
          typeof release.signer?.issuer !== "string" ||
          typeof release.signer?.attestationRef !== "string")) ||
      !isPluginVersionString(release.hostApiRange?.minimum) ||
      (release.hostApiRange?.maximum !== undefined &&
        !isPluginVersionString(release.hostApiRange.maximum)) ||
      !Number.isInteger(release.pluginDataSchemaVersion) ||
      typeof release.requiredPlatformSchemaVersion !== "string" ||
      !isInstallContractRangeSane(release.supportedInstallContracts)
    ) {
      throw new Error("Published plugin release data failed validation.");
    }

    if (
      release.runtimeProfile === "application" &&
      (release.buildDigest === null || release.buildArtifact === null)
    ) {
      throw new Error(
        "Published application releases require a verified build artifact.",
      );
    }

    if (
      release.runtimeProfile === "embedded" &&
      (release.buildDigest !== null || release.buildArtifact !== null)
    ) {
      throw new Error(
        "Published embedded releases cannot claim an independent build artifact.",
      );
    }

    const profileKey = `${release.pluginKey}:${release.runtimeProfile}`;
    const versionKey = `${release.pluginKey}:${release.version}`;
    if (profileKeys.has(profileKey) || versionKeys.has(versionKey)) {
      throw new Error("Published plugin release identities must be unique.");
    }
    profileKeys.add(profileKey);
    versionKeys.add(versionKey);
  }
}

/**
 * Code-owned publication evidence mirrored by the forward database migration.
 * CI hashes the exact files and verifies that sourceCommit is contained in the
 * private gitlink before a root release can advance.
 */
assertPublishedPluginReleases(releaseData);

export const publishedPluginReleases: PublishedPluginRelease[] = releaseData;

export function getPublishedPluginRelease(
  pluginKey: string,
  runtimeProfile: PluginRuntimeProfile,
): PublishedPluginRelease | undefined {
  return publishedPluginReleases
    .filter(
      (release) =>
        release.pluginKey === pluginKey &&
        release.runtimeProfile === runtimeProfile,
    )
    .sort((left, right) =>
      comparePluginVersions(right.version, left.version),
    )[0];
}
