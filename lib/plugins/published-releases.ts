import type {
  PluginHostApiRange,
  PluginReleaseInputs,
  PluginReleaseSigner,
} from "./sdk/v1/release";
import type { PluginInstallContractRange } from "./sdk/v1/compatibility";
import type { PluginRuntimeProfile } from "./sdk/v1/runtime-profile";

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

/**
 * Code-owned publication evidence mirrored by the forward database migration.
 * CI hashes the exact files and verifies that sourceCommit is contained in the
 * private gitlink before a root release can advance.
 */
export const publishedPluginReleases = [
  {
    pluginKey: "dv-speech-debate",
    version: "2.0.0",
    manifestFile: "plugins/dv-speech-debate/plugin.tsx",
    manifestHash:
      "82a9b548b570c8a2b7af3fe7a13fe889fc214abfb169ca0c64865063d4810f1b",
    sourceCommit: "5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5",
    automaticUpdate: false,
    rolloutPercentage: 0,
    runtimeProfile: "embedded",
    sourceTree: null,
    contentDigest: null,
    releaseInputs: null,
    buildDigest: null,
    sbomDigest: null,
    signer: null,
    hostApiRange: { minimum: "1.0.0", maximum: "1.0.0" },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: "legacy",
    supportedInstallContracts: { minimum: "2.0.0", maximum: "2.0.0" },
  },
  {
    pluginKey: "dvhs-csf",
    version: "1.1.0",
    manifestFile: "plugins/dvhs-csf/plugin-manifest.ts",
    manifestHash:
      "04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79",
    sourceCommit: "4d1001e9d3269b8bd28de93c071c6b4b216824fd",
    automaticUpdate: false,
    rolloutPercentage: 0,
    runtimeProfile: "embedded",
    sourceTree: null,
    contentDigest: null,
    releaseInputs: null,
    buildDigest: null,
    sbomDigest: null,
    signer: null,
    hostApiRange: { minimum: "1.0.0", maximum: "1.0.0" },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: "legacy",
    supportedInstallContracts: { minimum: "1.1.0", maximum: "1.1.0" },
  },
] as const satisfies readonly PublishedPluginRelease[];
