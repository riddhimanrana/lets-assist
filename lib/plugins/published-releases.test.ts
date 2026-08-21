import { describe, expect, test } from "bun:test";

import { assertPublishedPluginReleases } from "./published-releases";

const baseRelease = {
  pluginKey: "example-plugin",
  version: "1.2.0",
  manifestFile: "plugins/example-plugin/plugin.ts",
  manifestHash: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  automaticUpdate: false,
  rolloutPercentage: 0,
  runtimeProfile: "application",
  sourceTree: "c".repeat(40),
  contentDigest: `sha256:${"d".repeat(64)}`,
  releaseInputs: ["plugins/example-plugin", "apps/example"],
  buildDigest: `sha256:${"e".repeat(64)}`,
  buildArtifact: {
    name: "plugin-build.tar.gz",
    format: "vercel-prebuilt-v1",
    root: "apps/example",
    projectName: "example-app",
    projectId: "prj_example",
    organizationId: "team_example",
  },
  sbomDigest: `sha256:${"f".repeat(64)}`,
  signer: {
    identity:
      "https://github.com/example/repo/.github/workflows/release.yml@refs/tags/example/v1.2.0",
    issuer: "https://token.actions.githubusercontent.com",
    attestationRef: "github-release:example/v1.2.0/bundle.json",
  },
  hostApiRange: { minimum: "1.0.0", maximum: "1.0.0" },
  pluginDataSchemaVersion: 1,
  requiredPlatformSchemaVersion: "20260820130000",
  supportedInstallContracts: { minimum: "1.1.0", maximum: "1.2.0" },
} as const;

describe("published release validation", () => {
  test("accepts a complete application release", () => {
    expect(() => assertPublishedPluginReleases([baseRelease])).not.toThrow();
  });

  test("rejects an application release without verified build evidence", () => {
    expect(() =>
      assertPublishedPluginReleases([
        { ...baseRelease, buildDigest: null, buildArtifact: null },
      ]),
    ).toThrow("require a verified build artifact");
  });

  test("rejects empty deployment target coordinates", () => {
    expect(() =>
      assertPublishedPluginReleases([
        {
          ...baseRelease,
          buildArtifact: { ...baseRelease.buildArtifact, projectName: "" },
        },
      ]),
    ).toThrow("failed validation");
  });

  test("rejects independent artifacts on an embedded release", () => {
    expect(() =>
      assertPublishedPluginReleases([
        { ...baseRelease, runtimeProfile: "embedded" },
      ]),
    ).toThrow("cannot claim an independent build artifact");
  });

  test("rejects duplicate profile and version identities", () => {
    expect(() =>
      assertPublishedPluginReleases([baseRelease, { ...baseRelease }]),
    ).toThrow("identities must be unique");

    expect(() =>
      assertPublishedPluginReleases([
        baseRelease,
        {
          ...baseRelease,
          runtimeProfile: "embedded",
          buildDigest: null,
          buildArtifact: null,
        },
      ]),
    ).toThrow("identities must be unique");
  });
});
