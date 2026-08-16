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
    pluginKey: "calendar-tools",
    version: "1.0.0",
    manifestFile: "plugins/calendar-tools/plugin.tsx",
    manifestHash:
      "be1e70a3d3ab06b066fe302bc2404fcf248b5a9df5ccd8318ac4451ed9be3dc6",
    sourceCommit: "5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5",
    automaticUpdate: false,
    rolloutPercentage: 0,
  },
  {
    pluginKey: "community-impact-radar",
    version: "0.1.0",
    manifestFile: "plugins/community-impact-radar/plugin.tsx",
    manifestHash:
      "82f81a3504e5a21ede82e161e2ad84e11feb81df6ab5cbfdbd8e614b8e65e18c",
    sourceCommit: "5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5",
    automaticUpdate: false,
    rolloutPercentage: 0,
  },
  {
    pluginKey: "family-liaison-workbench",
    version: "0.1.0",
    manifestFile: "plugins/family-liaison-workbench/plugin.tsx",
    manifestHash:
      "c85614bc36e58d69ca1d05ac3636b28750048067de4a97f974c0404ec091b272",
    sourceCommit: "5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5",
    automaticUpdate: false,
    rolloutPercentage: 0,
  },
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
    version: "0.1.0",
    manifestFile: "plugins/dvhs-csf/plugin-manifest.ts",
    manifestHash:
      "e767ea535558bba0987e9b7dec8af7dc809c2131e725c3fa697e22d195a06f1a",
    sourceCommit: "5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5",
    automaticUpdate: false,
    rolloutPercentage: 0,
  },
] as const satisfies readonly PublishedPluginRelease[];
