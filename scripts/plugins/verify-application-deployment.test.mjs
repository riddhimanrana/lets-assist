import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { verifyApplicationDeployment } from "./verify-application-deployment.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plugin-deploy-"));
  temporaryDirectories.push(root);
  const buildPath = join(root, "plugin-build.tar.gz");
  writeFileSync(buildPath, "exact signed bytes");
  const buildDigest = `sha256:${createHash("sha256").update("exact signed bytes").digest("hex")}`;
  const buildArtifact = {
    name: "plugin-build.tar.gz",
    format: "vercel-prebuilt-v1",
    root: "apps/csf",
    projectName: "lets-assist-csf",
    projectId: "prj_child",
    organizationId: "team_owner",
  };
  const manifest = {
    pluginKey: "dvhs-csf",
    version: "1.2.0",
    tag: "dvhs-csf/v1.2.0",
    sourceCommit: "a".repeat(40),
    runtimeProfile: "application",
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
  return { ...paths, manifest, registry, targets };
}

function verify(input) {
  return verifyApplicationDeployment({
    manifestPath: input.manifestPath,
    registryPath: input.registryPath,
    targetsPath: input.targetsPath,
    buildPath: input.buildPath,
    releaseTag: "dvhs-csf/v1.2.0",
    pluginKey: "dvhs-csf",
  });
}

test("accepts exact signed bytes published for the approved target", () => {
  const input = fixture();
  assert.equal(verify(input).version, "1.2.0");
});

test("rejects bytes that differ from the signed digest", () => {
  const input = fixture();
  writeFileSync(input.buildPath, "different bytes");
  assert.throws(() => verify(input), /build digest/u);
});

test("rejects an application release absent from the host registry", () => {
  const input = fixture();
  writeFileSync(input.registryPath, "[]");
  assert.throws(() => verify(input), /not published/u);
});

test("rejects registry evidence bound to another release tag", () => {
  const input = fixture();
  input.registry[0].signer.attestationRef =
    "github-release:dvhs-csf/v1.2.1/release-manifest.sigstore.json";
  writeFileSync(input.registryPath, JSON.stringify(input.registry));
  assert.throws(() => verify(input), /registry does not match/u);
});

test("rejects a signed target outside the host allowlist", () => {
  const input = fixture();
  input.targets["dvhs-csf"].projectId = "prj_other";
  writeFileSync(input.targetsPath, JSON.stringify(input.targets));
  assert.throws(() => verify(input), /not approved/u);
});
