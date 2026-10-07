import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function applicationDeploymentFixture() {
  const root = mkdtempSync(join(tmpdir(), "plugin-deploy-"));

  const buildPath = join(root, "plugin-build-development.tar.gz");
  writeFileSync(buildPath, "exact signed bytes");
  const developmentDigest = `sha256:${createHash("sha256").update("exact signed bytes").digest("hex")}`;
  const productionDigest = `sha256:${"f".repeat(64)}`;
  const artifacts = {
    development: {
      name: "plugin-build-development.tar.gz",
      digest: developmentDigest,
    },
    production: {
      name: "plugin-build-production.tar.gz",
      digest: productionDigest,
    },
  };
  const buildDigest = `sha256:${createHash("sha256").update(JSON.stringify(artifacts)).digest("hex")}`;
  const buildArtifact = {
    format: "vercel-prebuilt-multi-env-v1",
    root: "apps/csf",
    projectName: "lets-assist-csf",
    projectId: "prj_child",
    organizationId: "team_owner",
    artifacts,
  };
  const manifest = {
    pluginKey: "dvhs-csf",
    version: "1.2.0",
    tag: "dvhs-csf/v1.2.0",
    sourceCommit: "a".repeat(40),
    runtimeProfile: "application",
    requiredPlatformSchemaVersion: "20260911203901",
    signerIdentity: { subject: "github", issuer: "github" },
    buildDigest,
    buildArtifact,
  };
  const registry = [
    {
      ...manifest,
      signer: {
        identity: "github",
        issuer: "github",
        attestationRef:
          "github-release:dvhs-csf/v1.2.0/release-manifest.sigstore.json",
      },
    },
  ];
  const targets = {
    "dvhs-csf": {
      root: "apps/csf",
      routingApplication: "lets-assist-csf",
      projectName: "lets-assist-csf",
      projectId: "prj_child",
      organizationId: "team_owner",
    },
  };
  const paths = {
    manifestPath: join(root, "manifest.json"),
    registryPath: join(root, "registry.json"),
    targetsPath: join(root, "targets.json"),
    buildPath,
  };
  writeFileSync(paths.manifestPath, JSON.stringify(manifest));
  writeFileSync(paths.registryPath, JSON.stringify(registry));
  writeFileSync(paths.targetsPath, JSON.stringify(targets));
  return {
    ...paths,
    manifest,
    registry,
    targets,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
