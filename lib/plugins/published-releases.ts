export type PublishedPluginRelease = {
  pluginKey: string;
  version: string;
  manifestFile: string;
  manifestHash: string;
  sourceCommit: string;
  automaticUpdate: boolean;
  rolloutPercentage: number;
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
  },
  {
    pluginKey: "dvhs-csf",
    version: "1.0.0",
    manifestFile: "plugins/dvhs-csf/plugin-manifest.ts",
    manifestHash:
      "7334038cb6519e1732d9ac9ba0111f0ae41cfef2861c36595be975ba60f95534",
    sourceCommit: "c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa",
    automaticUpdate: false,
    rolloutPercentage: 0,
  },
] as const satisfies readonly PublishedPluginRelease[];
