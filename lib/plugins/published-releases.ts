import type {
  PluginHostApiRange,
  PluginReleaseInputs,
  PluginReleaseSigner,
} from "./sdk/v1/release";
import {
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
  sbomDigest: string | null;
  signer: PluginReleaseSigner | null;
  hostApiRange: PluginHostApiRange;
  pluginDataSchemaVersion: number;
  requiredPlatformSchemaVersion: string;
  supportedInstallContracts: PluginInstallContractRange;
};

function assertPublishedPluginReleases(
  value: unknown,
): asserts value is PublishedPluginRelease[] {
  if (!Array.isArray(value)) {
    throw new Error("Published plugin release data must be an array.");
  }
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
): PublishedPluginRelease | undefined {
  return publishedPluginReleases.find(
    (release) => release.pluginKey === pluginKey,
  );
}
