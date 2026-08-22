import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/plugin-sdk-release.yml"),
  "utf8",
);

test("the SDK release accepts only an exact stable package tag from Development", () => {
  expect(workflow).toContain('expected_tag="plugin-sdk/v${package_version}"');
  expect(workflow).toContain(
    'if [[ "${GITHUB_REF_NAME}" != "${expected_tag}" ]]',
  );
  expect(workflow).toContain("git fetch --no-tags origin development");
  expect(workflow).toContain(
    'git merge-base --is-ancestor "${GITHUB_SHA}" origin/development',
  );
});

test("the SDK release signs immutable package and complete SBOM evidence without a registry token", () => {
  expect(workflow).toContain("cosign sign-blob --yes --bundle");
  expect(workflow).toContain("cosign verify-blob");
  expect(workflow).toContain("bunx @cyclonedx/cdxgen@12.8.4");
  expect(workflow).toContain("--fail-on-error");
  expect(workflow).toContain(
    'any(.components[]; .purl == "pkg:npm/ajv@8.20.0")',
  );
  expect(workflow).toContain(
    '.ref == "pkg:npm/@lets-assist/plugin-sdk@\\($version)"',
  );
  expect(workflow).toContain("plugin-sdk.cdx.json");
  expect(workflow).toContain("release-manifest.json");
  expect(workflow).toContain("release-manifest.sigstore.json");
  expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|npm publish/u);
});

test("the checksum manifest names every release input and cannot hash itself", () => {
  const checksumStep = workflow.slice(
    workflow.indexOf("cd .artifacts/plugin-sdk"),
    workflow.indexOf("- name: Retain signed SDK evidence"),
  );
  expect(checksumStep).toContain(
    "lets-assist-plugin-sdk-${{ steps.release.outputs.version }}.tgz",
  );
  expect(checksumStep).toContain("plugin-sdk.cdx.json");
  expect(checksumStep).toContain("release-manifest.json");
  expect(checksumStep).toContain("release-manifest.sigstore.json");
  expect(checksumStep).not.toContain(".artifacts/plugin-sdk/*");
  expect(checksumStep).toContain("cd .artifacts/plugin-sdk");
});
