import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { verifyApplicationDeployment } from "./verify-application-deployment.mjs";

import { applicationDeploymentFixture } from "./application-deployment-fixture.mjs";

const fixtures = [];
function fixture() {
  const value = applicationDeploymentFixture();
  fixtures.push(value);
  return value;
}

afterEach(() => {
  for (const value of fixtures.splice(0)) value.dispose();
});

function verify(input) {
  return verifyApplicationDeployment({
    manifestPath: input.manifestPath,
    registryPath: input.registryPath,
    targetsPath: input.targetsPath,
    buildPath: input.buildPath,
    releaseTag: "dvhs-csf/v1.2.0",
    pluginKey: "dvhs-csf",
    environment: "development",
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

test("rejects a build signed for another environment", () => {
  const input = fixture();
  input.manifest.buildArtifact.artifacts.development.name =
    "plugin-build-production.tar.gz";
  writeFileSync(input.manifestPath, JSON.stringify(input.manifest));
  assert.throws(() => verify(input), /no approved build artifact/u);
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

test("rejects a signed schema floor that differs from its publication", () => {
  const input = fixture();
  input.manifest.requiredPlatformSchemaVersion = "20261007200000";
  writeFileSync(input.manifestPath, JSON.stringify(input.manifest));
  assert.throws(() => verify(input), /registry does not match/u);
});
